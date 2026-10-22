import { isMcpUrl, mcpConnectionSchema } from '@sb/core/types'
import type { McpRuntimeScope, McpRuntimeStatus } from '@sb/core/types'
import { McpRegistry } from '@sb/sidecar/mcp/external/registry'
import { localEnvironment } from '@sb/sidecar/mcp/external/stdio'
import {
  lockWorkspaces,
  unlockWorkspaces,
} from '@sb/sidecar/mcp/workspace/context'
import { afterEach, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { mcpText } from '../helpers/mcp-result'

const registries: McpRegistry[] = []
const fixture = fileURLToPath(
  new URL('./fixtures/stateful.mjs', import.meta.url),
)
const argv = process.versions.bun ? ['--no-env-file', fixture] : [fixture]
const connection = mcpConnectionSchema.parse({
  transport: 'stdio',
  command: process.execPath,
  args: argv,
  startupTimeoutMs: 5000,
})
function registry() {
  const value = new McpRegistry()
  registries.push(value)
  return value
}
function scope(sessionId = 'chat'): McpRuntimeScope {
  return {
    key: randomUUID(),
    ownerId: 'owner',
    sessionId,
    agentId: 'agent',
    serverId: 'fixture',
    revision: '1',
  }
}
async function call(value: McpRegistry, status: McpRuntimeStatus, args = {}) {
  return JSON.parse(
    mcpText(await value.call(status.scope, 'counter', args, status)),
  ) as {
    count: number
    pid: number
    childPid?: number
    secret: boolean
    leaked: boolean
    arg?: string
  }
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await Bun.sleep(25)
  }
  throw new Error('Condition did not settle')
}
function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
afterEach(async () => {
  for (const value of registries.splice(0)) await value.close()
})

test('one process survives separate calls; concurrent connects do not launch duplicates', async () => {
  const value = registry(),
    identity = scope()
  const statuses = await Promise.all(
    Array.from({ length: 5 }, () => value.connect(identity, connection)),
  )
  expect(new Set(statuses.map((status) => status.generation)).size).toBe(1)
  const first = await call(value, statuses[0]),
    second = await call(value, statuses[1])
  expect([first.count, second.count]).toEqual([1, 2])
  expect(second.pid).toBe(first.pid)
})

test('chats, agents, and subagent sessions have independent state', async () => {
  const value = registry()
  const identities = [
    scope('parent'),
    scope('child'),
    { ...scope('parent'), agentId: 'other' },
    { ...scope('other-owner'), ownerId: 'other' },
  ]
  const statuses = await Promise.all(
    identities.map((identity) => value.connect(identity, connection)),
  )
  const outputs = await Promise.all(
    statuses.map((status) => call(value, status)),
  )
  expect(outputs.map((output) => output.count)).toEqual([1, 1, 1, 1])
  expect(new Set(outputs.map((output) => output.pid)).size).toBe(4)
})

test('tool calls are serialized on a connection', async () => {
  const value = registry(),
    status = await value.connect(scope(), connection)
  const [first, second] = await Promise.all([
    call(value, status, { delay: 40 }),
    call(value, status),
  ])
  expect([first.count, second.count]).toEqual([1, 2])
})

test('launch arguments stay literal and credential output is redacted across chunks', async () => {
  const value = registry()
  const status = await value.connect(scope(), {
    ...connection,
    args: [...argv, '$(echo should-not-execute)'],
    env: { FIXTURE_SECRET_DELAY: '200' },
    secretEnv: {
      FIXTURE_SECRET: 'fixture-private-value',
      SIDECAR_SECRET: 'forbidden',
    },
  })
  const output = await call(value, status)
  expect(output.arg).toBe('$(echo should-not-execute)')
  expect(output.secret).toBe(true)
  expect(output.leaked).toBe(false)
  expect(value.status(status.scope)?.stderr).not.toContain('\nfix')
  await Bun.sleep(250)
  expect(value.status(status.scope)?.stderr).toContain('[redacted]')
  expect(value.status(status.scope)?.stderr).not.toContain('private-value')
  expect(localEnvironment(connection)).not.toHaveProperty('SIDECAR_SECRET')
})

test('disconnect kills the owned process tree and rejects stale and queued calls', async () => {
  const value = registry(),
    status = await value.connect(scope(), connection)
  const output = await call(value, status, { child: true })
  await value.disconnect(status.scope)
  await until(() => !alive(output.pid))
  await until(() => !alive(output.childPid!))
  await expect(call(value, status)).rejects.toThrow('generation changed')
  await expect(value.connect(status.scope, connection)).rejects.toThrow(
    'revoked',
  )
})

test('process exit and sidecar replacement require explicit reconnection without replay', async () => {
  const value = registry(),
    status = await value.connect(scope(), connection)
  await expect(call(value, status, { crash: true })).rejects.toThrow()
  await until(() => value.status(status.scope)?.state === 'lost')
  await expect(value.connect(status.scope, connection, status)).rejects.toThrow(
    'lost',
  )
  await expect(
    registry().connect(status.scope, connection, status),
  ).rejects.toThrow('sidecar restart')
  const fresh = await value.connect(
    { ...status.scope, key: randomUUID(), epoch: 1 },
    connection,
  )
  expect((await call(value, fresh)).count).toBe(1)
})

test('startup failure is diagnosed and a closed service never launches again', async () => {
  const value = registry(),
    identity = scope()
  await expect(
    value.connect(identity, {
      ...connection,
      command: '/definitely-missing-mcp',
    }),
  ).rejects.toThrow()
  expect(value.status(identity)?.state).toBe('lost')
  await value.close()
  await expect(value.connect(scope(), connection)).rejects.toThrow(
    'shutting down',
  )
})

test('workspace locks reject new operations', async () => {
  const actual = `${Date.now() + 60_000}:fixture`
  await lockWorkspaces({ sessionIds: ['locked-chat'], token: actual })
  try {
    const { withWorkspaceOperation } =
      await import('@sb/sidecar/mcp/workspace/context')
    await expect(
      withWorkspaceOperation('locked-chat', async () => 'unexpected'),
    ).rejects.toThrow('updated')
  } finally {
    unlockWorkspaces({ sessionIds: ['locked-chat'], token: actual })
  }
})

test('connection validation supports local commands and the correct URL schemes', () => {
  expect(isMcpUrl('ws://localhost:9000', 'ws')).toBe(true)
  expect(isMcpUrl('wss://example.com', 'ws')).toBe(true)
  expect(isMcpUrl('ws://localhost', 'http')).toBe(false)
  expect(isMcpUrl('https://example.com', 'ws')).toBe(false)
  expect(
    mcpConnectionSchema.safeParse({ transport: 'stdio', command: '' }).success,
  ).toBe(false)
})

test('revocation rejects queued calls and a startup cancelled before handshake', async () => {
  const value = registry(),
    status = await value.connect(scope(), connection)
  const outcomes = Promise.allSettled([
    call(value, status, { delay: 2000 }),
    call(value, status),
  ])
  await Bun.sleep(30)
  await value.disconnect(status.scope)
  expect((await outcomes).map((result) => result.status)).toEqual([
    'rejected',
    'rejected',
  ])
  const identity = scope('startup')
  const startup = value.connect(identity, connection)
  const stopped = value.disconnect(identity)
  expect((await Promise.allSettled([startup, stopped]))[0].status).toBe(
    'rejected',
  )
  expect(value.status(identity)).toBeNull()
})

test('capacity errors preserve existing analysis state', async () => {
  const value = new McpRegistry(1)
  registries.push(value)
  const first = await value.connect(scope(), connection)
  expect((await call(value, first)).count).toBe(1)
  await expect(
    value.connect(scope('capacity-other'), connection),
  ).rejects.toThrow('capacity')
  expect((await call(value, first)).count).toBe(2)
})

test('shutdown cancels a hung handshake without waiting for the startup deadline', async () => {
  const value = registry()
  const identity = scope('hung-startup')
  const startup = value.connect(identity, {
    ...connection,
    startupTimeoutMs: 300_000,
    env: { FIXTURE_HANG_STARTUP: '1' },
  })
  const outcome = Promise.allSettled([startup])
  await until(() => !!value.status(identity)?.stderr.includes('fixture ready'))
  const started = Date.now()
  await value.close()
  expect(Date.now() - started).toBeLessThan(4000)
  expect((await outcome)[0].status).toBe('rejected')
  expect(value.list()).toEqual([])
})

test('a replacement closes the old process and stale authorizations cannot displace it', async () => {
  const value = registry()
  const first = await value.connect({ ...scope(), epoch: 1 }, connection)
  const output = await call(value, first)
  const next = await value.connect(
    { ...first.scope, key: randomUUID(), epoch: 2 },
    connection,
  )
  await until(() => !alive(output.pid))
  await expect(value.connect(first.scope, connection, first)).rejects.toThrow()
  expect((await call(value, next)).count).toBe(1)
})

import type { McpRuntimeScope, McpRuntimeStatus } from '@sb/core/types'
import { sidecarAuthentication } from '@sb/sidecar/auth'
import { externalMcpRoutes } from '@sb/sidecar/mcp/external/handlers'
import { mcpRegistry } from '@sb/sidecar/mcp/external/registry'
import {
  lockWorkspaces,
  unlockWorkspaces,
} from '@sb/sidecar/mcp/workspace/context'
import { afterEach, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { mcpText } from '~/tests/helpers/mcp-result'

const app = new Hono()
app.use('*', sidecarAuthentication('route-test-secret'))
app.route('/mcp-ext', externalMcpRoutes())
const fixture = fileURLToPath(
  new URL('../../fixtures/mcp/stateful.mjs', import.meta.url),
)
const connection = {
  transport: 'stdio',
  command: process.execPath,
  args: [...(process.versions.bun ? ['--no-env-file'] : []), fixture],
}
const scope = (): McpRuntimeScope => ({
  key: randomUUID(),
  ownerId: 'owner',
  sessionId: randomUUID(),
  agentId: 'agent',
  serverId: 'server',
  revision: '1',
})
function request(path: string, body: unknown) {
  return app.request(`/mcp-ext/${path}`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer route-test-secret',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}
afterEach(async () => {
  for (const status of mcpRegistry.list())
    await mcpRegistry.disconnect(status.scope)
})

test('MCP connection management is behind backend authentication', async () => {
  for (const path of [
    'connect',
    'call',
    'status',
    'disconnect',
    ...['probe', 'active', 'acknowledge', 'page', 'release'].map(
      (method) => `catalog/${method}`,
    ),
    ...[
      'start',
      'status',
      'cancel',
      'result',
      'acknowledge',
      'forget',
      'list',
    ].map((method) => `operations/${method}`),
  ]) {
    expect(
      (await app.request(`/mcp-ext/${path}`, { method: 'POST', body: '{}' }))
        .status,
    ).toBe(401)
  }
  expect((await app.request('/mcp-ext/runtimes')).status).toBe(401)
})

test('authenticated routes reuse one process and reject expired or revoked identities', async () => {
  const identity = scope()
  const connected = await request('connect', {
    scope: identity,
    connection,
    expiresAt: Date.now() + 30_000,
  })
  expect(connected.status).toBe(200)
  const status = (await connected.json()) as McpRuntimeStatus
  const payload = {
    scope: identity,
    bootId: status.bootId,
    generation: status.generation,
    expiresAt: Date.now() + 30_000,
    name: 'counter',
    args: {},
  }
  const first = await mcpRegistry.call(identity, 'counter', {}, payload)
  const second = await mcpRegistry.call(identity, 'counter', {}, payload)
  expect(JSON.parse(mcpText(first)).count).toBe(1)
  expect(JSON.parse(mcpText(second)).count).toBe(2)
  await expect(
    mcpRegistry.call(identity, 'counter', {}, { ...payload, expiresAt: 0 }),
  ).rejects.toThrow('expired')
  await request('disconnect', { scope: identity })
  await expect(
    mcpRegistry.call(identity, 'counter', {}, payload),
  ).rejects.toThrow()
  expect(
    (await request('call', { ...connection, name: 'counter' })).status,
  ).toBe(404)
})

test('workspace transition closes idle connections and prevents late dispatch', async () => {
  const identity = scope()
  await request('connect', {
    scope: identity,
    connection,
    expiresAt: Date.now() + 30_000,
  })
  const token = `${Date.now() + 60_000}:fixture`
  await lockWorkspaces({ sessionIds: [identity.sessionId], token })
  try {
    expect(mcpRegistry.status(identity)).toBeNull()
    expect(
      (
        await request('connect', {
          scope: scope(),
          connection,
          expiresAt: Date.now() + 30_000,
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await request('connect', {
          scope: identity,
          connection,
          expiresAt: Date.now() + 30_000,
        })
      ).status,
    ).not.toBe(200)
  } finally {
    unlockWorkspaces({ sessionIds: [identity.sessionId], token })
  }
})

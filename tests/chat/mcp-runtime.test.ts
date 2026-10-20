import type { Id } from '@sb/convex/_generated/dataModel'
import { _getExecution, list, replaceAll } from '@sb/convex/model/mcp'
import {
  done as finishCleanup,
  get as getCleanup,
} from '@sb/convex/model/mcpCleanup'
import {
  authorizeRuntime,
  connected,
  control,
  isAuthorized,
  retireCurrent,
  revoke,
  updateStatus,
} from '@sb/convex/model/mcpRuntime'
import { expect, test } from 'bun:test'

import { skillsDatabase } from '../helpers/skills-db'

async function fixture() {
  const fixture = skillsDatabase()
  const { db, ctx } = fixture
  await db.insert('users', { _id: 'owner', role: 'admin' })
  const agentId = (await db.insert('agents', {
    ownerId: 'owner',
    name: 'Agent',
    tools: ['local_counter'],
  })) as Id<'agents'>
  const sessionId = (await db.insert('sessions', {
    ownerId: 'owner',
  })) as Id<'sessions'>
  await db.insert('userSessions', { sessionId, userId: 'owner', role: 'owner' })
  await replaceAll(ctx, {
    servers: [
      {
        key: 'local',
        label: 'Local',
        url: '',
        transport: 'stdio',
        command: 'node',
        args: ['fixture.mjs'],
        enabled: true,
        tools: [{ name: 'counter' }],
      },
    ],
  })
  const input = {
    ownerId: 'owner' as Id<'users'>,
    sessionId,
    agentId,
    invokedBy: 'owner' as Id<'users'>,
    serverKey: 'local',
    revision: 1,
  }
  return { ...fixture, agentId, sessionId, input }
}

test('local credentials are stored separately and public views contain only binding names', async () => {
  const { ctx, rows } = await fixture()
  await replaceAll(ctx, {
    servers: [
      {
        key: 'local',
        label: 'Local',
        url: '',
        transport: 'stdio',
        command: 'node',
        enabled: true,
        secretEnv: { TOKEN: 'private-token' },
      },
    ],
  })
  const view = await list(ctx)
  expect(view[0].secretEnvNames).toEqual(['TOKEN'])
  expect(JSON.stringify(view)).not.toContain('private-token')
  expect(JSON.stringify(rows('mcpServers'))).not.toContain('private-token')
  expect(rows('credentials').some((row) => row.scope === 'mcp-env')).toBe(true)
})

test('local registration requires admin authority', async () => {
  const { ctx } = skillsDatabase()
  await expect(
    replaceAll(
      { ...ctx, role: 'user' },
      {
        servers: [
          {
            key: 'local',
            label: 'Local',
            url: '',
            transport: 'stdio',
            command: 'node',
            enabled: true,
          },
        ],
      },
    ),
  ).rejects.toThrow('admin')
})

test('stream authorization is checked against the actual child session', async () => {
  const { ctx, db, input, agentId, sessionId } = await fixture()
  const child = (await db.insert('sessions', {
    ownerId: 'owner',
    parent: { sessionId },
  })) as Id<'sessions'>
  const parentAuth = await authorizeRuntime(ctx, input)
  const childAuth = await authorizeRuntime(ctx, { ...input, sessionId: child })
  expect(childAuth.scope.sessionId).toBe(child)
  expect(childAuth.scope.key).not.toBe(parentAuth.scope.key)
  const streamId = (await db.insert('streams', {
    sessionId: child,
    agentId,
    invokedBy: 'owner',
    generation: 1,
    state: { phase: 'streaming' },
  })) as Id<'streams'>
  expect(
    await _getExecution(ctx, {
      agentId,
      sessionId,
      serverKey: 'local',
      streamId,
      generation: 1,
    }),
  ).toBeNull()
  expect(
    await _getExecution(ctx, {
      agentId,
      sessionId: child,
      serverKey: 'local',
      streamId,
      generation: 2,
    }),
  ).toBeNull()
  const actual = await _getExecution(ctx, {
    agentId,
    sessionId: child,
    serverKey: 'local',
    streamId,
    generation: 1,
  })
  expect(actual?.runtime.scope.key).toBe(childAuth.scope.key)
  await db.patch(sessionId, { mode: 'plan' })
  expect(
    (
      await _getExecution(ctx, {
        agentId,
        sessionId: child,
        serverKey: 'local',
        streamId,
        generation: 1,
      })
    )?.readOnly,
  ).toBe(true)
  await db.patch('owner', { role: 'user' })
  expect(
    await _getExecution(ctx, {
      agentId,
      sessionId: child,
      serverKey: 'local',
      streamId,
      generation: 1,
    }),
  ).toBeNull()
})

test('revocation journals cleanup, fences late connection results, and requires explicit reconnect', async () => {
  const { ctx, rows, input } = await fixture()
  const first = await authorizeRuntime(ctx, input)
  const ack = {
    runtimeId: first.runtimeId,
    key: first.scope.key,
    bootId: 'boot',
    generation: 'generation',
  }
  expect(await connected(ctx, ack)).toBe(true)
  await revoke(ctx, { sessionId: input.sessionId }, 'Session deleted')
  expect(rows('mcpCleanups')[0].scope).toEqual(first.scope)
  expect(await connected(ctx, ack)).toBe(false)
  await expect(authorizeRuntime(ctx, input)).rejects.toThrow('reconnect')
  await control(ctx, { runtimeId: first.runtimeId, reconnect: true })
  const next = await authorizeRuntime(ctx, input)
  expect(next.scope.key).not.toBe(first.scope.key)
  expect(next.bootId).toBeUndefined()
  expect(await connected(ctx, ack)).toBe(false)
})

test('disable and transport changes invalidate all active connection identities', async () => {
  const { ctx, rows, input } = await fixture()
  const first = await authorizeRuntime(ctx, input)
  await replaceAll(ctx, {
    servers: [
      {
        key: 'local',
        label: 'Local',
        url: '',
        transport: 'stdio',
        command: 'node',
        args: ['fixture.mjs'],
        enabled: false,
      },
    ],
  })
  expect(rows('mcpRuntimes')[0].state).toBe('disconnected')
  expect(rows('mcpCleanups')[0].scope).toEqual(first.scope)
  expect(rows('mcpServers')[0].revision).toBe(2)
})

test('clearing optional launch settings removes them without repeated revisions on subsequent saves', async () => {
  const { ctx, rows } = await fixture()
  const server = {
    key: 'local',
    label: 'Local',
    url: '',
    transport: 'stdio' as const,
    command: 'node',
    enabled: true,
  }
  await replaceAll(ctx, {
    servers: [{ ...server, cwd: '/toolkit', env: { MODE: 'test' } }],
  })
  await replaceAll(ctx, { servers: [server] })
  expect(rows('mcpServers')[0].cwd).toBeUndefined()
  expect(rows('mcpServers')[0].env).toBeUndefined()
  const revision = rows('mcpServers')[0].revision
  await replaceAll(ctx, { servers: [server] })
  expect(rows('mcpServers')[0].revision).toBe(revision)
})

test.each(['agent', 'invoker', 'session'] as const)(
  'runtime authorization rejects a missing %s',
  async (missing) => {
    const { ctx, db, input } = await fixture()
    const authorization = await authorizeRuntime(ctx, input)
    const row = (await ctx.db.get(authorization.runtimeId))!
    const ids = {
      agent: input.agentId,
      invoker: input.invokedBy,
      session: input.sessionId,
    }
    await db.delete(ids[missing])
    expect(await isAuthorized(ctx, row)).toBe(false)
  },
)

test.each(['disabled', 'locked'] as const)(
  'runtime authorization rejects a %s session',
  async (state) => {
    const { ctx, db, input } = await fixture()
    const authorization = await authorizeRuntime(ctx, input)
    const row = (await ctx.db.get(authorization.runtimeId))!
    const patch =
      state === 'disabled'
        ? { settings: { disabled: true } }
        : { contextLock: `${Date.now() + 60_000}:test` }
    await db.patch(input.sessionId, patch)
    expect(await isAuthorized(ctx, row)).toBe(false)
  },
)

test('late status updates and teardown cannot affect a replacement runtime', async () => {
  const { ctx, input, rows } = await fixture()
  const first = await authorizeRuntime(ctx, input)
  await control(ctx, { runtimeId: first.runtimeId, reconnect: true })
  const next = await authorizeRuntime(ctx, input)
  const cleanupCount = rows('mcpCleanups').length
  await updateStatus(ctx, {
    runtimeId: first.runtimeId,
    key: first.scope.key,
    state: 'lost',
  })
  await retireCurrent(ctx, {
    runtimeId: first.runtimeId,
    key: first.scope.key,
    reason: 'late teardown',
  })
  expect((await ctx.db.get(next.runtimeId))?.key).toBe(next.scope.key)
  expect((await ctx.db.get(next.runtimeId))?.state).toBe('connecting')
  expect(rows('mcpCleanups')).toHaveLength(cleanupCount)
})

test('cleanup acknowledgement is idempotent and disconnected runtimes reject late status', async () => {
  const { ctx, input, rows } = await fixture()
  const first = await authorizeRuntime(ctx, input)
  await revoke(ctx, { sessionId: input.sessionId }, 'revoked')
  await updateStatus(ctx, {
    runtimeId: first.runtimeId,
    key: first.scope.key,
    state: 'connected',
  })
  expect((await ctx.db.get(first.runtimeId))?.state).toBe('disconnected')
  const cleanupId = rows('mcpCleanups')[0]._id as Id<'mcpCleanups'>
  expect(await getCleanup(ctx, { cleanupId })).not.toBeNull()
  await finishCleanup(ctx, { cleanupId })
  await finishCleanup(ctx, { cleanupId })
  expect(await getCleanup(ctx, { cleanupId })).toBeNull()
})

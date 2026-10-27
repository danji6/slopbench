import type { Id } from '@sb/convex/_generated/dataModel'
import { availableIntegrations } from '@sb/convex/model/integrations/access'
import { configureComponent } from '@sb/convex/model/integrations/components'
import { observe } from '@sb/convex/model/integrations/observation'
import { publish } from '@sb/convex/model/integrations/publication'
import { select } from '@sb/convex/model/integrations/selection'
import { remove, settings } from '@sb/convex/model/integrations/settings'
import { skillAccess } from '@sb/convex/model/integrations/skills'
import { _getExecution, resolve } from '@sb/convex/model/mcp'
import { isAuthorized } from '@sb/convex/model/mcpRuntime'
import { isMcpToolSelected } from '@sb/convex/model/mcpToolPolicy'
import { expect, test } from 'bun:test'
import { fixture } from '~/tests/helpers/integration-activation'

test('linked integrations need only agent selection, which applies to every session', async () => {
  const f = await fixture()
  const selection = { integrationId: f.integrationId, agentId: f.agentId }
  const anotherSession = await f.db.insert('sessions', { ownerId: 'owner' })
  const active = (sessionId = f.sessionId) =>
    availableIntegrations(f.ctx, f.agentId, sessionId)
  expect(await active()).toHaveLength(0)
  await select(f.ctx, { ...selection, enabled: true })
  expect(await active()).toHaveLength(1)
  expect(await active(anotherSession as Id<'sessions'>)).toHaveLength(1)
  await select(f.ctx, { ...selection, enabled: false })
  expect(await active()).toHaveLength(0)
  expect(await active(anotherSession as Id<'sessions'>)).toHaveLength(0)
  await select(f.ctx, { ...selection, enabled: true })
  expect(await active()).toHaveLength(1)
})

test('unlinking revokes selected agents and queues teardown of live connections', async () => {
  const f = await fixture()
  await select(f.ctx, {
    integrationId: f.integrationId,
    agentId: f.agentId,
    enabled: true,
  })
  await _getExecution(f.ctx, {
    ...f.execution,
    sessionId: f.sessionId,
    agentId: f.agentId,
    serverKey: String(f.server.key),
  })
  expect(f.rows('mcpRuntimes')).toHaveLength(1)
  await remove(f.ctx, f.integrationId)
  expect(await availableIntegrations(f.ctx, f.agentId, f.sessionId)).toEqual([])
  expect((await f.db.get(f.agentId))?.integrationIds).toEqual([])
  expect(f.rows('mcpRuntimes')[0].state).toBe('disconnected')
  expect(f.rows('mcpCleanups')).toHaveLength(1)
  expect(f.rows('mcpServers')).toHaveLength(0)
  expect(f.rows('integrations')).toHaveLength(0)
  await expect(
    skillAccess(f.ctx, {
      ...f.execution,
      uri: `integration://${f.integrationId}/skills/review/SKILL.md`,
      offset: 0,
      length: 100,
    }),
  ).rejects.toThrow('unavailable')
})

test('subagents have a live parent ceiling and distinct runtime ownership', async () => {
  const f = await fixture()
  await select(f.ctx, {
    integrationId: f.integrationId,
    agentId: f.agentId,
    enabled: true,
  })
  const childAgent = (await f.db.insert('agents', {
    ownerId: 'owner',
    name: 'Child',
    integrationIds: [f.integrationId],
  })) as Id<'agents'>
  const childSession = (await f.db.insert('sessions', {
    ownerId: 'owner',
    parent: { sessionId: f.sessionId, agentId: f.agentId },
  })) as Id<'sessions'>
  expect(
    await availableIntegrations(f.ctx, childAgent, childSession),
  ).toHaveLength(1)
  const childStream = (await f.db.insert('streams', {
    sessionId: childSession,
    agentId: childAgent,
    invokedBy: 'owner',
    generation: 1,
    state: { phase: 'streaming' },
  })) as Id<'streams'>
  const parent = await _getExecution(f.ctx, {
    ...f.execution,
    sessionId: f.sessionId,
    agentId: f.agentId,
    serverKey: String(f.server.key),
  })
  const child = await _getExecution(f.ctx, {
    streamId: childStream,
    generation: 1,
    sessionId: childSession,
    agentId: childAgent,
    serverKey: String(f.server.key),
  })
  expect(parent?.runtime.scope.sessionId).toBe(f.sessionId)
  expect(child?.runtime.scope.sessionId).toBe(childSession)
  expect(child?.runtime.scope.key).not.toBe(parent?.runtime.scope.key)
  await select(f.ctx, {
    integrationId: f.integrationId,
    agentId: f.agentId,
    enabled: false,
  })
  expect(
    await availableIntegrations(f.ctx, childAgent, childSession),
  ).toHaveLength(0)
  const childRuntime = f
    .rows('mcpRuntimes')
    .find((row) => row.sessionId === childSession)!
  expect(childRuntime.state).toBe('disconnected')
  await select(f.ctx, {
    integrationId: f.integrationId,
    agentId: childAgent,
    enabled: true,
  })
  expect(
    await availableIntegrations(f.ctx, childAgent, childSession),
  ).toHaveLength(0)
})

test('integration brokers need no individual tool selections and cannot bypass component policy', async () => {
  const f = await fixture()
  await select(f.ctx, {
    integrationId: f.integrationId,
    agentId: f.agentId,
    enabled: true,
  })
  const server = (
    await resolve(f.ctx, 'owner' as Id<'users'>, {
      agentId: f.agentId,
      sessionId: f.sessionId,
    })
  )[0]
  expect(isMcpToolSelected({ tools: [] }, server, { name: 'tool-250' })).toBe(
    true,
  )
  expect(
    isMcpToolSelected({ tools: [] }, server, {
      name: 'tool-250',
      enabled: false,
    }),
  ).toBe(false)
  await configureComponent(f.ctx, {
    serverId: f.server._id as Id<'mcpServers'>,
    enabled: false,
  })
  expect(
    await _getExecution(f.ctx, {
      ...f.execution,
      sessionId: f.sessionId,
      agentId: f.agentId,
      serverKey: String(f.server.key),
    }),
  ).toBeNull()
})

test('selection changes revoke affected sessions without disconnecting an unrelated chat', async () => {
  const f = await fixture()
  await select(f.ctx, {
    integrationId: f.integrationId,
    agentId: f.agentId,
    enabled: true,
  })
  const otherAgent = (await f.db.insert('agents', {
    ownerId: 'owner',
    name: 'Other',
    integrationIds: [f.integrationId],
  })) as Id<'agents'>
  const second = (await f.db.insert('sessions', {
    ownerId: 'owner',
  })) as Id<'sessions'>
  await f.db.insert('userSessions', { sessionId: second, userId: 'owner' })
  const secondStream = (await f.db.insert('streams', {
    agentId: otherAgent,
    sessionId: second,
    invokedBy: 'owner',
    generation: 1,
    state: { phase: 'streaming' },
  })) as Id<'streams'>
  await _getExecution(f.ctx, {
    ...f.execution,
    sessionId: f.sessionId,
    agentId: f.agentId,
    serverKey: String(f.server.key),
  })
  await _getExecution(f.ctx, {
    streamId: secondStream,
    generation: 1,
    sessionId: second,
    agentId: otherAgent,
    serverKey: String(f.server.key),
  })
  await select(f.ctx, {
    integrationId: f.integrationId,
    agentId: f.agentId,
    enabled: false,
  })
  expect(
    f.rows('mcpRuntimes').find((row) => row.sessionId === f.sessionId)?.state,
  ).toBe('disconnected')
  const runtime = f.rows('mcpRuntimes').find((row) => row.sessionId === second)!
  expect(await isAuthorized(f.ctx, runtime as never)).toBe(true)
  expect(f.rows('mcpCleanups')).toHaveLength(1)
})

test('changed manifests apply on refresh and revoke previous execution generations', async () => {
  const f = await fixture()
  await select(f.ctx, {
    integrationId: f.integrationId,
    agentId: f.agentId,
    enabled: true,
  })
  const replacement = {
    ...f.input,
    integrationId: f.integrationId,
    revision: 'b',
    connections: [{ ...f.input.connections[0], command: 'replacement' }],
  }
  await _getExecution(f.ctx, {
    ...f.execution,
    sessionId: f.sessionId,
    agentId: f.agentId,
    serverKey: String(f.server.key),
  })
  const originalRuntime = structuredClone(f.rows('mcpRuntimes')[0])
  await publish(f.ctx, {
    ...f.input,
    integrationId: f.integrationId,
    previousRevision: 'a',
  })
  expect(f.rows('mcpRuntimes')[0]).toEqual(originalRuntime)
  expect(f.rows('mcpCleanups')).toHaveLength(0)
  await publish(f.ctx, replacement)
  expect(f.rows('mcpRuntimes')[0].state).toBe('disconnected')
  expect(f.rows('mcpCleanups')).toHaveLength(1)
  expect(
    await availableIntegrations(f.ctx, f.agentId, f.sessionId),
  ).toHaveLength(1)
  expect(f.rows('mcpServers')[0].command).toBe('replacement')
  expect(f.rows('integrations')[0].status).toBe('ready')
  const applied = structuredClone(f.rows('integrations')[0])
  await observe(f.ctx, {
    ...f.execution,
    integrationId: f.integrationId,
    acceptedRevision: 'a',
    observedRevision: 'outdated-observation',
  })
  expect(f.rows('integrations')[0]).toEqual(applied)
})

test('read_skill rechecks role, selection and component controls without granting a workspace', async () => {
  const f = await fixture()
  await select(f.ctx, {
    integrationId: f.integrationId,
    agentId: f.agentId,
    enabled: true,
  })
  const input = {
    ...f.execution,
    uri: `integration://${f.integrationId}/skills/review/SKILL.md`,
    offset: 0,
    length: 100,
  }
  expect(await skillAccess(f.ctx, input)).toMatchObject({
    root: '/toolkit',
    name: 'review',
  })
  expect(f.rows('sessions')[0].folderId).toBeUndefined()
  await settings(f.ctx, {
    integrationId: f.integrationId,
    disabledSkills: ['review'],
  })
  await expect(skillAccess(f.ctx, input)).rejects.toThrow('unavailable')
  await settings(f.ctx, { integrationId: f.integrationId, disabledSkills: [] })
  await f.db.patch('owner', { role: 'user' })
  await expect(skillAccess(f.ctx, input)).rejects.toThrow('Forbidden')
})

test('stale refreshes cannot replace newer snapshots or resurrect a removed installation', async () => {
  const f = await fixture()
  const replacement = {
    ...f.input,
    integrationId: f.integrationId,
    revision: 'b',
  }
  await expect(
    publish(f.ctx, {
      ...replacement,
      previousRevision: 'outdated',
    }),
  ).rejects.toThrow('changed during refresh')
  await expect(
    publish(f.ctx, { ...replacement, root: '/other-toolkit' }),
  ).rejects.toThrow('Linked root changed')
  await remove(f.ctx, f.integrationId)
  await expect(publish(f.ctx, replacement)).rejects.toThrow(
    'removed during refresh',
  )
  expect(f.rows('integrations')).toHaveLength(0)
})

test('workspace-dependent launches stay unavailable without a workspace and preserve user settings on updates', async () => {
  const f = await fixture()
  await configureComponent(f.ctx, {
    serverId: f.server._id as Id<'mcpServers'>,
    enabled: true,
    env: { INPUT: '${workspace}', LITERAL: '$HOME' },
    secretEnv: { TOKEN: 'private' },
  })
  await select(f.ctx, {
    integrationId: f.integrationId,
    agentId: f.agentId,
    enabled: true,
  })
  const without = (
    await resolve(f.ctx, 'owner' as Id<'users'>, {
      agentId: f.agentId,
      sessionId: f.sessionId,
    })
  )[0]
  expect(without.enabled).toBe(false)
  await publish(f.ctx, {
    ...f.input,
    integrationId: f.integrationId,
    revision: 'b',
    connections: [
      {
        ...f.input.connections[0],
        cwd: '${workspace}',
        args: ['--target', '${workspace}/input', '${workspace}'],
      },
    ],
  })
  expect(f.rows('mcpServers')[0].env).toEqual({
    INPUT: '${workspace}',
    LITERAL: '$HOME',
  })
  expect(
    f.rows('credentials').some((row) => String(row.apiKey).includes('private')),
  ).toBe(true)
  const folder = await f.db.insert('sessionFolders', {
    ownerId: 'owner',
    name: 'Target',
    revision: 1,
    sources: [
      { path: '/target', id: 'root', label: 'Root' },
      { path: '/secondary', id: 'secondary', label: 'Secondary' },
    ],
  })
  await f.db.patch(f.sessionId, { folderId: folder })
  const withWorkspace = (
    await resolve(f.ctx, 'owner' as Id<'users'>, {
      agentId: f.agentId,
      sessionId: f.sessionId,
    })
  )[0]
  expect(withWorkspace.enabled).toBe(true)
  expect(withWorkspace.cwd).toBe('/target')
  expect(withWorkspace.args).toEqual(['--target', '/target/input', '/target'])
  expect(withWorkspace.env).toEqual({ INPUT: '/target', LITERAL: '$HOME' })
})

test('change detection revokes execution without storing another manifest or consuming review capacity', async () => {
  const f = await fixture()
  for (let index = 0; index < 7; index++) {
    await f.db.insert('integrations', {
      ownerId: 'owner',
      root: `/other-${index}`,
      name: `Other ${index}`,
      revision: 'a',
      manifest: JSON.stringify({ description: 'x'.repeat(95 * 1024) }),
      status: 'ready',
      skillsEnabled: true,
      disabledSkills: [],
    })
  }
  await select(f.ctx, {
    integrationId: f.integrationId,
    agentId: f.agentId,
    enabled: true,
  })
  await _getExecution(f.ctx, {
    ...f.execution,
    sessionId: f.sessionId,
    agentId: f.agentId,
    serverKey: String(f.server.key),
  })
  await observe(f.ctx, {
    ...f.execution,
    integrationId: f.integrationId,
    acceptedRevision: 'a',
    observedRevision: 'b',
  })
  const row = await f.db.get(f.integrationId)
  expect(row?.status).toBe('changed')
  expect(row).not.toHaveProperty('candidate')
  expect(row?.manifest).toBe(f.input.manifest)
  expect(row?.revision).toBe('a')
  expect(row?.diagnostic).toContain('Refresh to apply')
  expect(f.rows('mcpRuntimes')[0].state).toBe('disconnected')
})

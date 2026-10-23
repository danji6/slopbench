import type { Doc, Id } from '@sb/convex/_generated/dataModel'
import { availableIntegrations } from '@sb/convex/model/integrations/access'
import { configureComponent } from '@sb/convex/model/integrations/components'
import { publish } from '@sb/convex/model/integrations/publication'
import { select } from '@sb/convex/model/integrations/selection'
import { settings } from '@sb/convex/model/integrations/settings'
import {
  integrationSkillFingerprint,
  withCurrentSkillContext,
} from '@sb/convex/model/integrations/skillContext'
import { prepareSkillContext } from '@sb/convex/model/skills/context'
import { inspectIntegration } from '@sb/sidecar/integrations/manifest'
import { type ToolSet, asSchema } from 'ai'
import { expect, spyOn, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { skillRequests } from '../helpers/skill-requests'
import { skillsDatabase } from '../helpers/skills-db'

async function toolDefinitions(tools: ToolSet) {
  return Promise.all(
    Object.entries(tools).map(async ([name, tool]) => ({
      name,
      description: tool.description,
      inputSchema: await asSchema(tool.inputSchema).jsonSchema,
    })),
  )
}

async function fixture() {
  const f = skillsDatabase()
  await f.db.insert('users', { _id: 'owner', subject: 'owner', role: 'admin' })
  const integrationId = await publish(f.ctx, {
    subject: 'owner',
    root: '/kit',
    revision: 'a',
    manifest: '{}',
    connections: [],
  })
  const agentId = (await f.db.insert('agents', {
    ownerId: 'owner',
    name: 'Agent',
    integrationIds: [integrationId],
  })) as Id<'agents'>
  async function stream(parent?: {
    sessionId: Id<'sessions'>
    agentId: Id<'agents'>
  }) {
    const sessionId = (await f.db.insert('sessions', {
      ownerId: 'owner',
      parent,
    })) as Id<'sessions'>
    await f.db.insert('userSessions', { sessionId, userId: 'owner' })
    const streamId = (await f.db.insert('streams', {
      agentId,
      sessionId,
      invokedBy: 'owner',
      generation: 1,
      state: { phase: 'streaming', processingMessageId: 'output' },
      skillContextPrepared: true,
      skillIntegrationFingerprint: await integrationSkillFingerprint(
        await availableIntegrations(f.ctx, agentId, sessionId),
      ),
    })) as Id<'streams'>
    return { streamId, sessionId, agentId }
  }
  const current = async (id: Id<'streams'>) => {
    const row = (await f.db.get(id)) as Doc<'streams'>
    return withCurrentSkillContext(
      row,
      await availableIntegrations(f.ctx, row.agentId, row.sessionId),
    )
  }
  return { ...f, integrationId, agentId, stream, current }
}

test('agent changes refresh affected executions and children without scanning history', async () => {
  const f = await fixture()
  const affected = await f.stream()
  const child = await f.stream({
    sessionId: affected.sessionId,
    agentId: f.agentId,
  })
  const unrelated = await f.stream()
  const otherAgent = await f.db.insert('agents', {
    ownerId: 'owner',
    name: 'Other',
    integrationIds: [f.integrationId],
  })
  await f.db.patch(unrelated.streamId, { agentId: otherAgent })
  const stopping = await f.stream()
  await f.db.patch(stopping.streamId, { state: { phase: 'stopping' } })
  for (let i = 0; i < 2000; i++) {
    await f.db.insert('messages', {
      sessionId: unrelated.sessionId,
      status: 'done',
      content: 'History',
    })
    await f.db.insert('streams', {
      agentId: f.agentId,
      sessionId: `history-${i}`,
      state: { phase: 'stopping' },
      skillContextPrepared: true,
    })
  }
  const before = structuredClone(f.rows('streams'))
  const query = spyOn(f.db, 'query')
  await select(f.ctx, {
    integrationId: f.integrationId,
    agentId: affected.agentId,
    enabled: false,
  })
  expect(query.mock.calls.some(([table]) => table === 'streams')).toBe(false)
  expect(f.rows('streams')).toEqual(before)
  expect((await f.current(affected.streamId)).skillContextPrepared).toBe(false)
  expect((await f.current(child.streamId)).skillContextPrepared).toBe(false)
  expect((await f.current(unrelated.streamId)).skillContextPrepared).toBe(true)
  expect(f.rows('messages')).toHaveLength(2000)
  query.mockRestore()
})

test('skill fingerprints respect skill and agent selections and ignore MCP-only edits', async () => {
  const f = await fixture()
  const a = await f.stream()
  const b = await f.stream()
  await select(f.ctx, {
    integrationId: f.integrationId,
    agentId: f.agentId,
    enabled: false,
  })
  expect((await f.current(a.streamId)).skillContextPrepared).toBe(false)
  expect((await f.current(b.streamId)).skillContextPrepared).toBe(false)
  await select(f.ctx, {
    integrationId: f.integrationId,
    agentId: f.agentId,
    enabled: true,
  })
  expect((await f.current(a.streamId)).skillContextPrepared).toBe(true)
  expect((await f.current(b.streamId)).skillContextPrepared).toBe(true)
  const serverId = (await f.db.insert('mcpServers', {
    ownerId: 'owner',
    integrationId: f.integrationId,
    key: 'component',
    enabled: true,
  })) as Id<'mcpServers'>
  await configureComponent(f.ctx, { serverId, enabled: false })
  expect((await f.current(b.streamId)).skillContextPrepared).toBe(true)
  await settings(f.ctx, {
    integrationId: f.integrationId,
    disabledSkills: ['review'],
  })
  expect((await f.current(b.streamId)).skillContextPrepared).toBe(false)
  await settings(f.ctx, {
    integrationId: f.integrationId,
    disabledSkills: [],
    skillsEnabled: false,
  })
  expect((await f.current(b.streamId)).skillContextPrepared).toBe(false)
})

test('context preparation persists the exact catalog configuration and survives a concurrent change', async () => {
  const f = await fixture()
  const target = await f.stream()
  const oldFingerprint = (await f.db.get(target.streamId))!
    .skillIntegrationFingerprint
  await settings(f.ctx, {
    integrationId: f.integrationId,
    disabledSkills: ['review'],
  })
  const integrationFingerprint = await integrationSkillFingerprint(
    await availableIntegrations(f.ctx, f.agentId, target.sessionId),
  )
  const args = {
    streamId: target.streamId,
    generation: 1,
    fingerprint: 'catalog',
    integrationFingerprint,
    content: 'Updated skills',
  }
  expect(integrationFingerprint).not.toBe(oldFingerprint)
  expect(await prepareSkillContext(f.ctx, args)).toBe(true)
  expect((await f.current(target.streamId)).skillContextPrepared).toBe(true)
  expect((await f.db.get(target.streamId))?.skillIntegrationFingerprint).toBe(
    integrationFingerprint,
  )
  expect(f.rows('messages')).toHaveLength(1)
  await prepareSkillContext(f.ctx, args)
  expect(f.rows('messages')).toHaveLength(1)

  // A catalog read begun before a disable must not mark the new configuration prepared.
  await settings(f.ctx, {
    integrationId: f.integrationId,
    skillsEnabled: false,
  })
  await prepareSkillContext(f.ctx, {
    ...args,
    integrationFingerprint: String(oldFingerprint),
  })
  expect((await f.current(target.streamId)).skillContextPrepared).toBe(false)
  await f.db.patch(target.streamId, { skillIntegrationFingerprint: undefined })
  expect((await f.current(target.streamId)).skillContextPrepared).toBe(false)
})

test('provider preparation refreshes integration notes within a turn and preserves stored context', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'integration-context-'))
  const f = skillRequests(root)
  try {
    await mkdir(path.join(root, '.agents/skills/review'), { recursive: true })
    await writeFile(path.join(root, '.agents/integration.json'), '{}')
    await writeFile(
      path.join(root, '.agents/skills/review/SKILL.md'),
      '---\nname: review\ndescription: Inspect evidence\n---\nInstructions',
    )
    await f.db.patch('owner', { subject: 'owner' })
    const snapshot = await inspectIntegration(root)
    const integrationId = await publish(f.ctx, {
      subject: 'owner',
      root,
      revision: snapshot.revision,
      manifest: JSON.stringify(snapshot.manifest),
      connections: [],
    })
    f.folder.sources[0].discoverSkills = false
    const first = (await f.nextTurn())!
    const initialNotes = structuredClone(f.rows('messageContents'))
    const stream = f.rows('streams')[0]
    const input = {
      integrationId,
      agentId: stream.agentId as Id<'agents'>,
      sessionId: stream.sessionId as Id<'sessions'>,
    }
    await select(f.ctx, { ...input, enabled: true })
    const second = (await f.repeat())!
    expect(second.systemPrompt).toBe(first.systemPrompt)
    expect(second.messages.slice(0, first.messages.length - 1)).toEqual(
      first.messages.slice(0, -1),
    )
    expect(JSON.stringify(second.messages.at(-1))).toContain(
      `integration://${integrationId}/skills/review/SKILL.md`,
    )
    const notes = structuredClone(f.rows('messageContents'))
    expect(notes.slice(0, initialNotes.length)).toEqual(initialNotes)
    expect((await f.repeat())!.messages).toEqual(second.messages)
    expect(f.rows('messageContents')).toEqual(notes)
    await writeFile(
      path.join(root, '.agents/integration.json'),
      '{"name":"Updated toolkit"}',
    )
    const updated = await inspectIntegration(root)
    await publish(f.ctx, {
      subject: 'owner',
      integrationId,
      root,
      previousRevision: snapshot.revision,
      revision: updated.revision,
      manifest: JSON.stringify(updated.manifest),
      connections: [],
    })
    const refreshed = (await f.repeat())!
    expect(refreshed.systemPrompt).toBe(second.systemPrompt)
    expect(await toolDefinitions(refreshed.tools)).toEqual(
      await toolDefinitions(second.tools),
    )
    expect(refreshed.messages.slice(0, second.messages.length - 1)).toEqual(
      second.messages.slice(0, -1),
    )
    expect(JSON.stringify(refreshed.messages.at(-1))).toContain(
      'Updated toolkit',
    )
    expect(f.rows('messageContents').slice(0, notes.length)).toEqual(notes)
    const refreshedNotes = structuredClone(f.rows('messageContents'))
    await select(f.ctx, { ...input, enabled: false })
    const third = (await f.repeat())!
    expect(third.messages.slice(0, refreshed.messages.length - 1)).toEqual(
      refreshed.messages.slice(0, -1),
    )
    expect(JSON.stringify(third.messages.at(-1))).toContain(
      'No skills are currently available',
    )
    expect(f.rows('messageContents').slice(0, refreshedNotes.length)).toEqual(
      refreshedNotes,
    )
  } finally {
    f.restore()
    await rm(root, { recursive: true, force: true })
  }
})

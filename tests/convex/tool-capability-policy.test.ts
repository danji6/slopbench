import { hasStoredMcpOutput } from '@sb/convex/model/tool/availabilityRead'
import { sessionToolNames } from '@sb/convex/model/tool/selection'
import { expect, test } from 'bun:test'

import { skillsDatabase } from '../helpers/skills-db'

test('stored-output eligibility is confined to the owner, actual session, and agent', async () => {
  const f = skillsDatabase()
  const agent = { _id: 'agent', ownerId: 'owner', tools: ['mcp_access'] }
  for (const fields of [
    { sessionId: 'other-session', agentId: 'agent', ownerId: 'owner' },
    { sessionId: 'session', agentId: 'child-agent', ownerId: 'owner' },
    { sessionId: 'session', agentId: 'agent', ownerId: 'other-owner' },
    { sessionId: 'session', agentId: 'agent', ownerId: 'owner', deleted: true },
  ])
    await f.db.insert('mcpOperations', { output: '{}', ...fields })
  expect(
    await hasStoredMcpOutput(f.ctx, 'session' as never, agent as never),
  ).toBe(false)
  const id = await f.db.insert('mcpOperations', {
    sessionId: 'session',
    agentId: 'agent',
    ownerId: 'owner',
    outputRef: 'blob',
  })
  expect(
    await hasStoredMcpOutput(f.ctx, 'session' as never, agent as never),
  ).toBe(true)
  await f.db.patch(id, { deleted: true })
  expect(
    await hasStoredMcpOutput(f.ctx, 'session' as never, agent as never),
  ).toBe(false)
})

test('mode and delegation policy follow frozen selections until reset and respect privilege changes', async () => {
  const f = skillsDatabase()
  await f.db.insert('users', { _id: 'owner', role: 'admin' })
  const agent = { _id: 'agent', ownerId: 'owner', tools: [] }
  const cache = await f.db.insert('sessionCache', {
    sessionId: 'session',
    agentId: 'agent',
    filesystemAccess: true,
    tools: { version: 7, names: ['task', 'write_plan'] },
  })
  expect(
    await sessionToolNames(
      f.ctx,
      'session' as never,
      agent as never,
      'owner' as never,
    ),
  ).toEqual(['task', 'write_plan'])
  await f.db.delete(cache)
  expect(
    await sessionToolNames(
      f.ctx,
      'session' as never,
      agent as never,
      'owner' as never,
    ),
  ).toEqual([])
  agent.tools = ['task', 'plan'] as never
  await f.db.patch('owner', { role: 'user' })
  expect(
    await sessionToolNames(
      f.ctx,
      'session' as never,
      agent as never,
      'owner' as never,
    ),
  ).toEqual(['task'])
})

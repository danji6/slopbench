import type { Id } from '@sb/convex/_generated/dataModel'
import { _getProviderHistory } from '@sb/convex/model/stream/reads'
import { expect, test } from 'bun:test'
import { skillsDatabase } from '~/tests/helpers/skills-db'

test('current MCP guidance crosses the frozen history boundary and other agents guidance stays scoped', async () => {
  const f = skillsDatabase()
  for (const [id, agent, time] of [
    ['own', 'agent-one', 6],
    ['other', 'agent-two', 7],
    ['current', 'agent-one', 20],
  ] as const) {
    await f.db.insert('messages', {
      _id: id,
      sessionId: 'session',
      _creationTime: time,
      role: 'system',
      sender: { type: 'agent', id: agent },
      status: 'done',
      contextEligible: true,
      hidden: true,
      type: 'mcp',
      selectedVersion: 1,
    })
    await f.db.insert('messageContents', {
      messageId: id,
      version: 1,
      segmentIndex: 0,
      parts: [{ type: 'text', text: `Guidance for ${agent}` }],
    })
  }
  const streamId = (await f.db.insert('streams', {
    agentId: 'agent-one',
    sessionId: 'session',
    generation: 1,
    contextBoundaryCreationTime: 10,
    mcpContextMessageId: 'current',
    command: { kind: 'invoke' },
    state: { phase: 'streaming' },
  })) as Id<'streams'>
  const history = await _getProviderHistory(f.ctx, { streamId, generation: 1 })
  expect(history.map((message) => String(message._id))).toEqual([
    'own',
    'current',
  ])
  expect(history[1].parts).toEqual([
    { type: 'text', text: 'Guidance for agent-one' },
  ])
})

import type { Id } from '@sb/convex/_generated/dataModel'
import { publish } from '@sb/convex/model/integrations/publication'
import { skillsDatabase } from '~/tests/helpers/skills-db'

export async function fixture() {
  const f = skillsDatabase()
  await f.db.insert('users', { _id: 'owner', subject: 'owner', role: 'admin' })
  const agentId = (await f.db.insert('agents', {
    ownerId: 'owner',
    name: 'Agent',
    tools: [],
  })) as Id<'agents'>
  const sessionId = (await f.db.insert('sessions', {
    ownerId: 'owner',
    activeAgentId: agentId,
  })) as Id<'sessions'>
  await f.db.insert('userSessions', {
    sessionId,
    userId: 'owner',
    role: 'owner',
  })
  const streamId = (await f.db.insert('streams', {
    sessionId,
    agentId,
    invokedBy: 'owner',
    generation: 1,
    state: { phase: 'streaming', processingMessageId: 'message' },
  })) as Id<'streams'>
  const input = {
    subject: 'owner',
    root: '/toolkit',
    revision: 'a',
    manifest: JSON.stringify({
      name: 'Fixture',
      mcpServers: { main: { command: 'fixture' } },
    }),
    connections: [
      {
        name: 'main',
        command: 'fixture',
        cwd: '/toolkit',
        url: '',
        transport: 'stdio' as const,
      },
    ],
  }
  const integrationId = await publish(f.ctx, input)
  const server = f.rows('mcpServers')[0]
  const execution = { streamId, generation: 1 }
  return { ...f, integrationId, server, input, agentId, sessionId, execution }
}

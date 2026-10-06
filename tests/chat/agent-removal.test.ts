import { remove } from '@sb/convex/model/agents'
import { expect, test } from 'bun:test'

test.each(['agent_1', 'agent_2', undefined])(
  'deleting an agent only clears a matching recent selection (%s)',
  async (recentAgentId) => {
    const settings = { _id: 'settings_1', recentAgentId }
    const patches: unknown[] = []
    const deleted: string[] = []
    const ctx = {
      userId: 'owner_1',
      db: {
        get: async () => ({ _id: 'agent_1', ownerId: 'owner_1' }),
        query: () => ({
          withIndex: () => ({
            unique: async () => settings,
            collect: async () => [],
            order: () => ({ collect: async () => [] }),
          }),
        }),
        patch: async (id: string, patch: unknown) => {
          patches.push({ id, patch })
        },
        delete: async (id: string) => {
          deleted.push(id)
        },
      },
    } as never

    await remove(ctx, { agentId: 'agent_1' as never })

    expect(patches).toEqual(
      recentAgentId === 'agent_1'
        ? [
            {
              id: 'settings_1',
              patch: { recentAgentId: undefined },
            },
          ]
        : [],
    )
    expect(deleted).toEqual(['agent_1'])
  },
)

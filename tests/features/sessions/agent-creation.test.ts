import type { Id } from '@sb/convex/_generated/dataModel'
import type { AuthMutationCtx } from '@sb/convex/functions'
import { create } from '@sb/convex/model/agents'
import { createDefaultAgent } from '@sb/convex/model/defaults'
import { expect, test } from 'bun:test'

test('creation persists the agent and every prompt scope together', async () => {
  const rows: Array<{ table: string; fields: Record<string, unknown> }> = []
  const ctx = {
    userId: 'owner',
    db: {
      insert: async (table: string, fields: Record<string, unknown>) => {
        rows.push({ table, fields })
        return table === 'agents' ? 'agent' : `row-${rows.length}`
      },
    },
  } as unknown as AuthMutationCtx
  const defaults = createDefaultAgent()
  const prompt = defaults.prompts[0] as Extract<
    (typeof defaults.prompts)[number],
    { content: string }
  >
  expect(
    await create(ctx, {
      name: 'Writer',
      prompts: defaults.prompts,
      compactionPrompts: [prompt],
      impersonationPrompts: [prompt],
      reminderPrompts: [
        {
          id: 'reminder',
          name: 'Check',
          role: 'system',
          content: 'Check',
          interval: 2,
          enabled: true,
        },
      ],
    }),
  ).toBe('agent' as Id<'agents'>)

  const agent = rows.find((row) => row.table === 'agents')!
  expect(agent.fields).not.toHaveProperty('prompts')
  expect(agent.fields).not.toHaveProperty('compactionPrompts')
  expect(agent.fields).not.toHaveProperty('impersonationPrompts')
  expect(
    rows
      .filter((row) => row.table === 'prompts')
      .map((row) => row.fields.scope),
  ).toEqual(['own', 'own', 'own', 'compaction', 'impersonation'])
  expect(rows.filter((row) => row.table === 'reminders')).toHaveLength(1)
})

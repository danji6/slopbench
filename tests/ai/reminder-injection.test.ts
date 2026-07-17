/// <reference types="bun-types" />
import {
  bumpTurnCount,
  injectDueReminders,
  rewindTurnCount,
} from '@sb/convex/model/chat/reminders'
import type { ReminderPrompt } from '@sb/core/types'
import { describe, expect, test } from 'bun:test'

function reminder(overrides: Partial<ReminderPrompt> = {}): ReminderPrompt {
  return {
    id: 'r1',
    name: 'Reminder',
    role: 'system',
    content: 'stay focused',
    enabled: true,
    interval: 2,
    ...overrides,
  }
}

type InjectCtxArgs = {
  agent?: Record<string, unknown> | null
  settings?: Record<string, unknown> | null
  session?: Record<string, unknown>
}

function makeCtx({ agent, settings = null, session }: InjectCtxArgs = {}) {
  const inserts: Array<{ table: string; doc: Record<string, unknown> }> = []
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = []
  const scheduled: Array<Record<string, unknown>> = []

  const docs = new Map<string, unknown>()
  if (agent) docs.set(agent._id as string, agent)
  if (session) docs.set(session._id as string, session)

  const ctx = {
    db: {
      get: async (id: string) => docs.get(id) ?? null,
      insert: async (table: string, doc: Record<string, unknown>) => {
        inserts.push({ table, doc })
        return `${table}_${inserts.length}`
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch })
      },
      query: (table: string) => ({
        withIndex: () => ({
          unique: async () => (table === 'settings' ? settings : null),
        }),
      }),
    },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, args: unknown) => {
        scheduled.push(args as Record<string, unknown>)
        return 'job_1'
      },
    },
  } as never

  return { ctx, inserts, patches, scheduled }
}

const baseAgent = { _id: 'agent_1', name: 'Agent', ownerId: 'user_1' }

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'session_1',
    activeAgentId: 'agent_1',
    ...overrides,
  }
}

describe('injectDueReminders', () => {
  test('inserts a due reminder as a hidden done message without search text', async () => {
    const { ctx, inserts, patches } = makeCtx({
      agent: { ...baseAgent, reminderPrompts: [reminder()] },
      session: baseSession({ turnCount: 6, reminderState: { r1: 4 } }),
    })

    await injectDueReminders(
      ctx,
      baseSession({ turnCount: 6, reminderState: { r1: 4 } }) as never,
      'user_1' as never,
    )

    const message = inserts.find((entry) => entry.table === 'messages')
    expect(message?.doc).toMatchObject({
      sessionId: 'session_1',
      sender: { type: 'agent', id: 'agent_1' },
      role: 'system',
      status: 'done',
      type: 'reminder',
      hidden: true,
      extra: { id: 'r1', name: 'Reminder' },
      contextEligible: true,
    })

    const content = inserts.find((entry) => entry.table === 'messageContents')
    expect(content?.doc.parts).toEqual([{ type: 'text', text: 'stay focused' }])
    expect(content?.doc.searchText).toBeUndefined()

    expect(patches.find((entry) => entry.id === 'session_1')?.patch).toEqual({
      reminderState: { r1: 6 },
    })
  })

  test('seeds a baseline for unseen reminders without inserting', async () => {
    const session = baseSession({ turnCount: 6 })
    const { ctx, inserts, patches } = makeCtx({
      agent: { ...baseAgent, reminderPrompts: [reminder()] },
      session,
    })

    await injectDueReminders(ctx, session as never, 'user_1' as never)

    expect(inserts).toEqual([])
    expect(patches.find((entry) => entry.id === 'session_1')?.patch).toEqual({
      reminderState: { r1: 6 },
    })
  })

  test('does nothing before the interval elapses', async () => {
    const session = baseSession({ turnCount: 5, reminderState: { r1: 4 } })
    const { ctx, inserts, patches } = makeCtx({
      agent: { ...baseAgent, reminderPrompts: [reminder()] },
      session,
    })

    await injectDueReminders(ctx, session as never, 'user_1' as never)

    expect(inserts).toEqual([])
    expect(patches).toEqual([])
  })

  test('ignores global reminders when the agent opts out', async () => {
    const session = baseSession({ turnCount: 10, reminderState: { g1: 2 } })
    const { ctx, inserts, patches } = makeCtx({
      agent: { ...baseAgent, globalRemindersEnabled: false },
      settings: { reminderPrompts: [reminder({ id: 'g1' })] },
      session,
    })

    await injectDueReminders(ctx, session as never, 'user_1' as never)

    expect(inserts).toEqual([])
    // The opted-out reminder's stale state entry is pruned
    expect(patches.find((entry) => entry.id === 'session_1')?.patch).toEqual({
      reminderState: {},
    })
  })

  test('injects global reminders from the agent owner settings', async () => {
    const session = baseSession({ turnCount: 8, reminderState: { g1: 5 } })
    const { ctx, inserts } = makeCtx({
      agent: baseAgent,
      settings: {
        reminderPrompts: [reminder({ id: 'g1', role: 'user', interval: 3 })],
      },
      session,
    })

    await injectDueReminders(ctx, session as never, 'user_1' as never)

    const message = inserts.find((entry) => entry.table === 'messages')
    expect(message?.doc).toMatchObject({ role: 'user', hidden: true })
  })

  test('schedules an eval for dynamic reminder content', async () => {
    const session = baseSession({ turnCount: 4, reminderState: { r1: 2 } })
    const { ctx, scheduled } = makeCtx({
      agent: {
        ...baseAgent,
        reminderPrompts: [reminder({ content: 'hello {{user}}' })],
      },
      session,
    })

    await injectDueReminders(ctx, session as never, 'user_1' as never)

    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]).toMatchObject({ invokerId: 'user_1' })
  })
})

describe('bumpTurnCount', () => {
  test('increments the counter from an unset baseline', async () => {
    const { ctx, patches } = makeCtx({ session: baseSession() })

    await bumpTurnCount(ctx, 'session_1' as never)

    expect(patches).toEqual([{ id: 'session_1', patch: { turnCount: 1 } }])
  })

  test('increments an existing counter', async () => {
    const { ctx, patches } = makeCtx({
      session: baseSession({ turnCount: 41 }),
    })

    await bumpTurnCount(ctx, 'session_1' as never)

    expect(patches).toEqual([{ id: 'session_1', patch: { turnCount: 42 } }])
  })
})

describe('noteDeletedTurns', () => {
  test('rewinds the counter and keeps baselines below it untouched', async () => {
    const { ctx, patches } = makeCtx({
      session: baseSession({ turnCount: 12, reminderState: { r1: 4 } }),
    })

    await rewindTurnCount(ctx, 'session_1' as never, 5)

    expect(patches).toEqual([
      { id: 'session_1', patch: { turnCount: 7, reminderState: { r1: 4 } } },
    ])
  })

  test('clamps baselines above the rewound counter', async () => {
    const { ctx, patches } = makeCtx({
      session: baseSession({ turnCount: 12, reminderState: { r1: 10, r2: 3 } }),
    })

    await rewindTurnCount(ctx, 'session_1' as never, 6)

    expect(patches).toEqual([
      {
        id: 'session_1',
        patch: { turnCount: 6, reminderState: { r1: 6, r2: 3 } },
      },
    ])
  })

  test('floors the counter at zero', async () => {
    const { ctx, patches } = makeCtx({
      session: baseSession({ turnCount: 3 }),
    })

    await rewindTurnCount(ctx, 'session_1' as never, 10)

    expect(patches).toEqual([{ id: 'session_1', patch: { turnCount: 0 } }])
  })

  test('does nothing without deletions or a counter', async () => {
    const { ctx, patches } = makeCtx({ session: baseSession() })

    await rewindTurnCount(ctx, 'session_1' as never, 3)
    await rewindTurnCount(ctx, 'session_1' as never, 0)

    expect(patches).toEqual([])
  })
})

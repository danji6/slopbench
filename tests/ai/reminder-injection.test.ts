/// <reference types="bun-types" />
import { injectDueReminders } from '@sb/convex/model/chat/reminders'
import { advanceStepCount, getStepCount } from '@sb/convex/model/session/state'
import type { ReminderPrompt } from '@sb/core/types'
import { describe, expect, test } from 'bun:test'

import { fakeSessionState } from '../setup/session-state'

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
  /** Rows in the `reminders` table, by scope. */
  reminders?: ReminderPrompt[]
  libraryReminders?: ReminderPrompt[]
  /** Baselines, which live on the session's state row. */
  reminderState?: Record<string, number>
  stepCount?: number
}

function makeCtx({
  agent,
  settings = null,
  session,
  reminders = [],
  libraryReminders = [],
  reminderState,
  stepCount,
}: InjectCtxArgs = {}) {
  const state = fakeSessionState(
    reminderState || stepCount !== undefined
      ? { reminderState, stepCount }
      : null,
  )
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
        if (table === 'sessionState') return state.insert(doc)
        inserts.push({ table, doc })
        return `${table}_${inserts.length}`
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        if (state.owns(id)) return void state.patch(patch)
        patches.push({ id, patch })
      },
      query: (table: string) => ({
        withIndex: (index: string) => ({
          unique: async () =>
            table === 'sessionState'
              ? state.row
              : table === 'settings'
                ? settings
                : null,
          // Reminder rows are keyed by scope; the index names them apart
          order: () => ({
            collect: async () =>
              (index === 'by_agentId_scope_order'
                ? reminders
                : libraryReminders
              ).map((item, order) => ({
                _id: `reminders_${item.id}`,
                ownerId: 'user_1',
                order,
                key: item.id,
                item,
              })),
          }),
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

  return { ctx, inserts, patches, scheduled, state }
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
    const { ctx, inserts, state } = makeCtx({
      agent: baseAgent,
      reminders: [reminder()],
      session: baseSession(),
      reminderState: { r1: 4 },
    })

    await injectDueReminders(ctx, baseSession() as never, 'user_1' as never, 6)

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

    expect(state.patches).toEqual([{ reminderState: { r1: 6 } }])
  })

  test('seeds a baseline for unseen reminders without inserting', async () => {
    const session = baseSession()
    const { ctx, inserts, state } = makeCtx({
      agent: baseAgent,
      reminders: [reminder()],
      session,
    })

    await injectDueReminders(ctx, session as never, 'user_1' as never, 6)

    expect(inserts).toEqual([])
    expect(state.patches).toEqual([{ reminderState: { r1: 6 }, stepCount: 0 }])
  })

  test('does nothing before the interval elapses', async () => {
    const session = baseSession()
    const { ctx, inserts, state } = makeCtx({
      agent: baseAgent,
      reminders: [reminder()],
      session,
      reminderState: { r1: 4 },
    })

    await injectDueReminders(ctx, session as never, 'user_1' as never, 5)

    expect(inserts).toEqual([])
    expect(state.patches).toEqual([])
  })

  test('ignores library reminders the agent does not reference', async () => {
    const session = baseSession()
    const { ctx, inserts, state } = makeCtx({
      agent: baseAgent,
      libraryReminders: [reminder({ id: 'g1' })],
      session,
      reminderState: { g1: 2 },
    })

    await injectDueReminders(ctx, session as never, 'user_1' as never, 10)

    expect(inserts).toEqual([])
    // The unreferenced reminder's stale state entry is pruned
    expect(state.patches).toEqual([{ reminderState: {} }])
  })

  test('injects referenced library reminders from the agent owner settings', async () => {
    const session = baseSession()
    const { ctx, inserts } = makeCtx({
      agent: { ...baseAgent, libraryReminderIds: ['g1'] },
      libraryReminders: [reminder({ id: 'g1', role: 'user', interval: 3 })],
      session,
      reminderState: { g1: 5 },
    })

    await injectDueReminders(ctx, session as never, 'user_1' as never, 8)

    const message = inserts.find((entry) => entry.table === 'messages')
    expect(message?.doc).toMatchObject({ role: 'user', hidden: true })
  })

  test('schedules an eval for dynamic reminder content', async () => {
    const session = baseSession()
    const { ctx, scheduled } = makeCtx({
      agent: baseAgent,
      reminders: [reminder({ content: 'hello {{user}}' })],
      session,
      reminderState: { r1: 2 },
    })

    await injectDueReminders(ctx, session as never, 'user_1' as never, 4)

    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]).toMatchObject({ invokerId: 'user_1' })
  })
})

describe('provider step clock', () => {
  test('increments the hot counter from an unset baseline', async () => {
    const { ctx, patches, state } = makeCtx({ session: baseSession() })

    expect(await advanceStepCount(ctx, 'session_1' as never)).toBe(1)

    expect(patches).toEqual([])
    expect(state.patches).toEqual([{ stepCount: 1 }])
  })

  test('increments an existing hot counter', async () => {
    const { ctx, state } = makeCtx({
      session: baseSession(),
      stepCount: 41,
    })

    expect(await advanceStepCount(ctx, 'session_1' as never)).toBe(42)
    expect(state.patches).toEqual([{ stepCount: 42 }])
  })

  test('reads zero before the hot state is created', async () => {
    const { ctx } = makeCtx({ session: baseSession() })

    expect(await getStepCount(ctx, 'session_1' as never)).toBe(0)
  })
})

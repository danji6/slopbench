/// <reference types="bun-types" />
import {
  mergeReminders,
  resolveDueReminders,
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
    interval: 5,
    ...overrides,
  }
}

describe('resolveDueReminders', () => {
  test('seeds a baseline for a new reminder without firing', () => {
    const { due, nextState } = resolveDueReminders([reminder()], undefined, 7)

    expect(due).toEqual([])
    expect(nextState).toEqual({ r1: 7 })
  })

  test('an eager reminder fires on first sight and then follows the interval', () => {
    const eager = reminder({ eager: true })

    const first = resolveDueReminders([eager], undefined, 7)
    expect(first.due.map((r) => r.id)).toEqual(['r1'])
    expect(first.nextState).toEqual({ r1: 7 })

    // After the initial firing it behaves like any other reminder
    const notYet = resolveDueReminders([eager], first.nextState, 11)
    expect(notYet.due).toEqual([])

    const again = resolveDueReminders([eager], first.nextState, 12)
    expect(again.due.map((r) => r.id)).toEqual(['r1'])
  })

  test('fires once a full interval has elapsed and resets the baseline', () => {
    const notYet = resolveDueReminders([reminder()], { r1: 7 }, 11)
    expect(notYet.due).toEqual([])
    expect(notYet.nextState).toEqual({ r1: 7 })

    const fired = resolveDueReminders([reminder()], { r1: 7 }, 12)
    expect(fired.due.map((r) => r.id)).toEqual(['r1'])
    expect(fired.nextState).toEqual({ r1: 12 })
  })

  test('handles multiple reminders with independent intervals', () => {
    const reminders = [
      reminder({ id: 'a', interval: 2 }),
      reminder({ id: 'b', interval: 4 }),
    ]

    const { due, nextState } = resolveDueReminders(
      reminders,
      { a: 8, b: 8 },
      10,
    )

    expect(due.map((r) => r.id)).toEqual(['a'])
    expect(nextState).toEqual({ a: 10, b: 8 })
  })

  test('prunes state for removed and disabled reminders', () => {
    const { due, nextState } = resolveDueReminders(
      [reminder({ id: 'kept' }), reminder({ id: 'off', enabled: false })],
      { kept: 3, off: 3, deleted: 3 },
      4,
    )

    expect(due).toEqual([])
    expect(nextState).toEqual({ kept: 3 })
  })

  test('never fires disabled or non-positive-interval reminders', () => {
    const { due } = resolveDueReminders(
      [
        reminder({ id: 'off', enabled: false }),
        reminder({ id: 'zero', interval: 0 }),
      ],
      { off: 0, zero: 0 },
      100,
    )

    expect(due).toEqual([])
  })
})

describe('mergeReminders', () => {
  const library = [reminder({ id: 'g1' }), reminder({ id: 'g2' })]

  test('appends agent reminders after the referenced library ones', () => {
    const merged = mergeReminders(
      {
        reminderPrompts: [reminder({ id: 'own' })],
        libraryReminderIds: ['g1', 'g2'],
      },
      library,
    )

    expect(merged.map((r) => r.id)).toEqual(['g1', 'g2', 'own'])
  })

  test('resolves library reminders in reference order', () => {
    const merged = mergeReminders({ libraryReminderIds: ['g2', 'g1'] }, library)

    expect(merged.map((r) => r.id)).toEqual(['g2', 'g1'])
  })

  test('skips library reminders the agent does not reference', () => {
    const merged = mergeReminders(
      { reminderPrompts: [reminder({ id: 'own' })] },
      library,
    )

    expect(merged.map((r) => r.id)).toEqual(['own'])
  })

  test('skips references to reminders that no longer exist', () => {
    const merged = mergeReminders(
      { libraryReminderIds: ['g1', 'deleted'] },
      library,
    )

    expect(merged.map((r) => r.id)).toEqual(['g1'])
  })

  test('an agent reminder overrides a library one with the same id', () => {
    const merged = mergeReminders(
      {
        reminderPrompts: [reminder({ id: 'g1', content: 'agent version' })],
        libraryReminderIds: ['g1', 'g2'],
      },
      library,
    )

    expect(merged).toHaveLength(2)
    expect(merged.find((r) => r.id === 'g1')?.content).toBe('agent version')
  })
})

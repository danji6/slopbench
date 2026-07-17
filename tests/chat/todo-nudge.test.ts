/// <reference types="bun-types" />
import {
  buildTodoNudgeContent,
  isTodoNudgeDue,
} from '@sb/convex/model/chat/reminders'
import { formatTodoList, hasUnresolvedTodos } from '@sb/convex/model/todos'
import type { TodoItem } from '@sb/convex/types'
import { describe, expect, test } from 'bun:test'

function items(...statuses: TodoItem['status'][]): TodoItem[] {
  return statuses.map((status, index) => ({
    content: `task ${index + 1}`,
    status,
  }))
}

describe('isTodoNudgeDue', () => {
  test('never fires without a todo row', () => {
    expect(isTodoNudgeDue(null, 10)).toBe(false)
  })

  test('never fires when every todo is completed', () => {
    const todo = { items: items('completed', 'completed'), turnCount: 0 }
    expect(isTodoNudgeDue(todo, 10)).toBe(false)
  })

  test('fires only once a full interval has elapsed', () => {
    const todo = { items: items('pending'), turnCount: 4 }
    expect(isTodoNudgeDue(todo, 6, 3)).toBe(false)
    expect(isTodoNudgeDue(todo, 7, 3)).toBe(true)
    expect(isTodoNudgeDue(todo, 9, 3)).toBe(true)
  })

  test('counts in_progress todos as unresolved', () => {
    const todo = { items: items('in_progress', 'completed'), turnCount: 0 }
    expect(isTodoNudgeDue(todo, 5, 3)).toBe(true)
  })

  test('waits out a rewound counter instead of firing early', () => {
    // After deletions the session counter can fall below the baseline
    const todo = { items: items('pending'), turnCount: 10 }
    expect(isTodoNudgeDue(todo, 4, 3)).toBe(false)
    expect(isTodoNudgeDue(todo, 13, 3)).toBe(true)
  })
})

describe('hasUnresolvedTodos', () => {
  test('true while any todo is pending or in progress', () => {
    expect(hasUnresolvedTodos(items('completed', 'pending'))).toBe(true)
    expect(hasUnresolvedTodos(items('completed', 'in_progress'))).toBe(true)
  })

  test('false for an empty or fully completed list', () => {
    expect(hasUnresolvedTodos([])).toBe(false)
    expect(hasUnresolvedTodos(items('completed', 'completed'))).toBe(false)
  })
})

describe('formatTodoList', () => {
  test('renders one glyph-prefixed line per status', () => {
    const list = formatTodoList([
      { content: 'first', status: 'completed' },
      { content: 'second', status: 'in_progress' },
      { content: 'third', status: 'pending' },
    ])

    expect(list).toBe('[x] first\n[-] second\n[ ] third')
  })
})

describe('buildTodoNudgeContent', () => {
  test('wraps the current list in a system-reminder block', () => {
    const content = buildTodoNudgeContent(items('pending', 'in_progress'))

    expect(content.startsWith('<system-reminder>')).toBe(true)
    expect(content.endsWith('</system-reminder>')).toBe(true)
    expect(content).toContain('[ ] task 1')
    expect(content).toContain('[-] task 2')
    expect(content).toContain('edit_todo')
    expect(content).toContain('write_todo')
  })
})

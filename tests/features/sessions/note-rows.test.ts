import { projectNoteRows } from '@/lib/chat/note-rows'
import { createNoteExpansionStore, noteContentKey } from '@/lib/chat/note-state'
import { buildRows } from '@/lib/chat/rows'
import type { MessageRecord } from '@/lib/chat/types'
import { describe, expect, test } from 'bun:test'

function rowsFor(ids: string[], visible: string[] = [], groupBySender = true) {
  const types: MessageRecord['type'][] = [
    'skills',
    'mcp',
    'workspace',
    'mode',
    'reminder',
    'todo',
    'command',
    undefined,
  ]
  return buildRows(
    ids,
    (id) => ({ id, role: 'system', parts: [{ type: 'text', text: id }] }),
    (id) =>
      ({
        hidden: !visible.includes(id),
        type: visible.includes(id) ? undefined : types[ids.indexOf(id)],
        sender: { type: 'agent', id: 'agent' },
      }) as MessageRecord,
    undefined,
    { groupBySender },
  )
}

describe('note rows', () => {
  test('groups mixed hidden types and retains each message address', () => {
    const ids = Array.from({ length: 8 }, (_, index) => `n${index}`)
    const rows = rowsFor(ids)
    expect(rows[0]).toEqual({
      kind: 'note-group',
      key: 'notes:n0',
      messageId: 'n0',
      count: 8,
    })
    expect(rows.slice(1).map((row) => row.messageId)).toEqual(ids)
    expect(
      rows
        .slice(1)
        .every((row) => row.kind === 'hidden' && row.placement === 'grouped'),
    ).toBe(true)
    expect(projectNoteRows(rows, new Set())).toEqual([rows[0]])
    expect(projectNoteRows(rows, new Set(['notes:n0']))).toEqual(rows)
  })

  test('visible messages split runs and solitary notes need no wrapper', () => {
    const rows = rowsFor(['a', 'b', 'visible', 'c'], ['visible'])
    expect(rows.filter((row) => row.kind === 'note-group')).toHaveLength(1)
    expect(rows.at(-1)).toMatchObject({ kind: 'hidden', messageId: 'c' })
    expect(rows.at(-1)).not.toHaveProperty('noteGroupId')
    expect(
      projectNoteRows(rows, new Set()).map((row) => row.messageId),
    ).toEqual(['a', 'visible', 'visible', 'c'])
  })

  test('append and deletion update count and restore singleton presentation', () => {
    const state = createNoteExpansionStore()
    const before = rowsFor(['a', 'b'])
    state.setOpen(before[0].key, true)
    const appended = rowsFor(['a', 'b', 'c'])
    expect(appended[0]).toMatchObject({ key: before[0].key, count: 3 })
    expect(projectNoteRows(appended, state.getSnapshot())).toEqual(appended)
    expect(rowsFor(['a', 'c'])[0]).toMatchObject({
      key: before[0].key,
      count: 2,
    })
    expect(rowsFor(['a'])).toEqual([
      { kind: 'hidden', key: 'hid:a', messageId: 'a', placement: 'standalone' },
    ])
  })

  test.each([true, false])(
    'only chips within a continuing sender group are inline (groupBySender=%s)',
    (groupBySender) => {
      const rows = rowsFor(
        ['start', 'before', 'middle', 'after', 'end'],
        ['before', 'after'],
        groupBySender,
      )
      const chips = rows.filter((row) => row.kind === 'hidden')
      expect(chips.map((row) => row.placement)).toEqual([
        'standalone',
        groupBySender ? 'inline' : 'standalone',
        'standalone',
      ])
    },
  )

  test('sender grouping survives a group of hidden notes', () => {
    const rows = rowsFor(['visible', 'a', 'b', 'later'], ['visible', 'later'])
    expect(rows.some((row) => row.key === 'h:later')).toBe(false)
    expect(rows.find((row) => row.kind === 'note-group')).toMatchObject({
      grouped: true,
    })
    expect(rows.at(-1)).toMatchObject({ grouped: true, messageId: 'later' })
  })

  test('group and individual state remain independent across projections', () => {
    const rows = rowsFor(['a', 'b'])
    const state = createNoteExpansionStore()
    state.setOpen('notes:a', true)
    state.setOpen(noteContentKey('b'), true)
    state.setOpen('notes:a', false)
    expect(projectNoteRows(rows, state.getSnapshot())).toHaveLength(1)
    expect(state.getSnapshot().has(noteContentKey('b'))).toBe(true)
    expect(state.getSnapshot().has(noteContentKey('a'))).toBe(false)
    state.setOpen('notes:a', true)
    expect(projectNoteRows(rows, state.getSnapshot())).toHaveLength(3)
  })

  test('retains only mounted notes until the group finishes closing', () => {
    const rows = rowsFor(['a', 'b', 'c'])
    const state = createNoteExpansionStore()
    const project = () =>
      projectNoteRows(rows, state.getSnapshot(), state.getTransitions())
    state.setOpen('notes:a', true)
    state.setOpen(noteContentKey('a'), true)
    state.setOpen('notes:a', false, new Set(['hid:a']))
    expect(project()).toEqual([rows[0], rows[1]])
    expect(project()[1]).toBe(rows[1])
    state.finishClosing('notes:a', state.getTransitions().get('notes:a')!)
    expect(project()).toEqual([rows[0]])
    expect(state.getSnapshot().has(noteContentKey('a'))).toBe(true)
  })

  test('closing a group with no mounted children removes them immediately', () => {
    const rows = rowsFor(['a', 'b'])
    const state = createNoteExpansionStore()
    state.setOpen('notes:a', true)
    state.setOpen('notes:a', false, new Set())
    expect(
      projectNoteRows(rows, state.getSnapshot(), state.getTransitions()),
    ).toEqual([rows[0]])
    state.setOpen('notes:a', true)
  })
})

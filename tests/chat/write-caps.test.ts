/// <reference types="bun-types" />
import {
  assertCustomCssCap,
  assertPartsCap,
  assertPlanContentCap,
  assertSegmentFits,
  assertTodoItemsCap,
} from '@sb/convex/model/caps'
import { insertMessage } from '@sb/convex/model/messageContents'
import {
  appendApprovals,
  setApprovalMode,
} from '@sb/convex/model/session/state'
import { MESSAGE_SPLIT_BUDGET_BYTES } from '@sb/core/const'
import { createVariableStore } from '@sb/core/interpreter/store'
import {
  MAX_APPROVAL_PATTERNS,
  MAX_CUSTOM_CSS_CHARS,
  MAX_ENVIRONMENT_BYTES,
  MAX_ENVIRONMENT_KEYS,
  MAX_MESSAGE_PART_BYTES,
  MAX_PLAN_CONTENT_CHARS,
  MAX_SEGMENT_BYTES,
  MAX_TODO_CONTENT_CHARS,
  MAX_TODO_ITEMS,
} from '@sb/core/limits'
import { splitParts } from '@sb/core/utils/size'
import {
  MAX_DIR_ENTRIES,
  MAX_TEXT_SNAPSHOT_CHARS,
} from '@sb/core/workspace/files'
import { clampLinkSnapshot } from '@sb/core/workspace/snapshot'
import { describe, expect, test } from 'bun:test'

import { fakeSessionState } from '../setup/session-state'

const SESSION = 'session_1'

const text = (chars: number) => ({ type: 'text', text: 'x'.repeat(chars) })

describe('splitParts', () => {
  test('always yields one chunk, even with nothing to split', () => {
    expect(splitParts([], 100)).toEqual([[]])
  })

  test('keeps a message that fits in a single chunk', () => {
    const parts = [text(10), text(10)]
    expect(splitParts(parts, 1_000)).toEqual([parts])
  })

  test('starts a new chunk once the budget is passed', () => {
    const chunks = splitParts([text(60), text(60), text(60)], 100)

    expect(chunks).toHaveLength(3)
    expect(chunks.flat()).toHaveLength(3)
  })

  test('never splits inside a part', () => {
    const huge = text(500)
    const chunks = splitParts([huge, text(10)], 100)

    // The oversized part gets its own chunk rather than being cut in half
    expect(chunks[0]).toEqual([huge])
    expect(chunks[1]).toEqual([text(10)])
  })
})

describe('clampLinkSnapshot', () => {
  test('re-clamps a text snapshot the client inflated', () => {
    const clamped = clampLinkSnapshot({
      kind: 'text',
      path: 'a.ts',
      content: 'x'.repeat(MAX_TEXT_SNAPSHOT_CHARS + 5_000),
      truncated: false,
    })

    expect(clamped.kind).toBe('text')
    if (clamped.kind !== 'text') return
    expect(clamped.content).toHaveLength(MAX_TEXT_SNAPSHOT_CHARS)
    // Clamping is visible in history rather than silent
    expect(clamped.truncated).toBe(true)
  })

  test('re-clamps a directory listing', () => {
    const clamped = clampLinkSnapshot({
      kind: 'directory',
      path: 'src',
      entries: Array.from({ length: MAX_DIR_ENTRIES + 10 }, (_, i) => `f${i}`),
      truncated: false,
    })

    expect(clamped.kind).toBe('directory')
    if (clamped.kind !== 'directory') return
    expect(clamped.entries).toHaveLength(MAX_DIR_ENTRIES)
    expect(clamped.truncated).toBe(true)
  })

  test('leaves a snapshot within its caps alone', () => {
    const snapshot = {
      kind: 'text',
      path: 'a.ts',
      content: 'hello',
      truncated: false,
    } as const

    expect(clampLinkSnapshot(snapshot)).toEqual(snapshot)
  })
})

describe('environment caps', () => {
  test('rejects a setVar past the key count', () => {
    const initial = Object.fromEntries(
      Array.from({ length: MAX_ENVIRONMENT_KEYS }, (_, i) => [`k${i}`, 1]),
    )
    const store = createVariableStore(initial)

    expect(() => store.set('one_too_many', 1)).toThrow(
      /Session variables limit exceeded/,
    )
    // The rejected key must not survive in the record that gets persisted
    expect(store.toRecord().one_too_many).toBeUndefined()
    expect(store.isDirty()).toBe(false)
  })

  test('rejects a setVar past the byte budget', () => {
    const store = createVariableStore()

    expect(() => store.set('big', 'x'.repeat(MAX_ENVIRONMENT_BYTES))).toThrow(
      /bytes/,
    )
    expect(store.toRecord()).toEqual({})
  })

  test('restores the previous value when an overwrite is rejected', () => {
    const store = createVariableStore({ a: 'small' })

    expect(() => store.set('a', 'x'.repeat(MAX_ENVIRONMENT_BYTES))).toThrow()
    expect(store.toRecord()).toEqual({ a: 'small' })
  })

  test('accepts a write that fits', () => {
    const store = createVariableStore()
    store.set('a', 1)

    expect(store.toRecord()).toEqual({ a: 1 })
    expect(store.isDirty()).toBe(true)
  })
})

describe('appendApprovals', () => {
  function makeCtx(state: ReturnType<typeof fakeSessionState>) {
    return {
      db: {
        query: () => ({ withIndex: () => state.query() }),
        insert: async (_table: string, doc: Record<string, unknown>) =>
          state.insert(doc),
        patch: async (_id: string, patch: Record<string, unknown>) =>
          state.patch(patch),
      },
    } as never
  }

  test('remembers an approval', async () => {
    const state = fakeSessionState({})
    await appendApprovals(makeCtx(state), SESSION as never, 'tools', ['shell'])

    expect(state.row?.toolApprovals).toEqual({ tools: ['shell'] })
  })

  test('toggles unrestricted access without losing remembered approvals', async () => {
    const state = fakeSessionState({
      toolApprovals: { shell: ['git push'], paths: ['/tmp'] },
    })
    const ctx = makeCtx(state)

    await setApprovalMode(ctx, SESSION as never, 'unrestricted')
    expect(state.row?.toolApprovals).toEqual({
      mode: 'unrestricted',
      shell: ['git push'],
      paths: ['/tmp'],
    })

    await setApprovalMode(ctx, SESSION as never, 'ask')
    expect(state.row?.toolApprovals).toEqual({
      shell: ['git push'],
      paths: ['/tmp'],
    })
  })

  test('drops additions past the cap instead of failing the approval', async () => {
    const existing = Array.from(
      { length: MAX_APPROVAL_PATTERNS },
      (_, i) => `cmd_${i}`,
    )
    const state = fakeSessionState({ toolApprovals: { shell: existing } })

    await appendApprovals(makeCtx(state), SESSION as never, 'shell', ['extra'])

    // At the cap there is nothing to write, so the state row is untouched
    expect(state.patches).toHaveLength(0)
    expect(state.row?.toolApprovals).toEqual({ shell: existing })
  })

  test('truncates a partially-fitting batch', async () => {
    const existing = Array.from(
      { length: MAX_APPROVAL_PATTERNS - 1 },
      (_, i) => `cmd_${i}`,
    )
    const state = fakeSessionState({ toolApprovals: { shell: existing } })

    await appendApprovals(makeCtx(state), SESSION as never, 'shell', ['a', 'b'])

    const approvals = state.row?.toolApprovals as { shell: string[] }
    expect(approvals.shell).toHaveLength(MAX_APPROVAL_PATTERNS)
    expect(approvals.shell.at(-1)).toBe('a')
  })
})

describe('cap assertions', () => {
  test('custom CSS', () => {
    expect(() => assertCustomCssCap('body{}')).not.toThrow()
    expect(() =>
      assertCustomCssCap('x'.repeat(MAX_CUSTOM_CSS_CHARS + 1)),
    ).toThrow(/Custom CSS/)
  })

  test('todo items', () => {
    const items = Array.from({ length: MAX_TODO_ITEMS + 1 }, () => ({
      content: 'a',
      status: 'pending' as const,
    }))

    expect(() => assertTodoItemsCap(items)).toThrow(/Todos limit exceeded/)
    expect(() =>
      assertTodoItemsCap([
        { content: 'x'.repeat(MAX_TODO_CONTENT_CHARS + 1), status: 'pending' },
      ]),
    ).toThrow(/characters/)
  })

  test('plan content', () => {
    expect(() => assertPlanContentCap('# Plan')).not.toThrow()
    expect(() =>
      assertPlanContentCap('x'.repeat(MAX_PLAN_CONTENT_CHARS + 1)),
    ).toThrow(/Plan content limit exceeded/)
  })

  test('an oversized single part is rejected, not split', () => {
    expect(() => assertPartsCap([text(MAX_MESSAGE_PART_BYTES + 1)])).toThrow(
      /Message part limit exceeded/,
    )
  })

  test('a single-row write must fit one segment', () => {
    const parts = Array.from({ length: 4 }, () => text(MAX_SEGMENT_BYTES / 3))

    // Each part fits on its own, but they cannot share a row
    expect(() => assertPartsCap(parts)).not.toThrow()
    expect(() => assertSegmentFits(parts)).toThrow(/Message content/)
  })
})

describe('insertMessage', () => {
  function makeCtx() {
    const tables: Record<string, Record<string, unknown>[]> = {
      messages: [],
      messageContents: [],
    }
    let nextId = 1

    const ctx = {
      db: {
        insert: async (table: string, doc: Record<string, unknown>) => {
          const _id = `${table}_${nextId++}`
          tables[table].push({ _id, ...doc })
          return _id
        },
      },
    } as never

    return { ctx, tables }
  }

  const fields = {
    sessionId: SESSION,
    sender: { type: 'user', id: 'user_1' },
    role: 'user',
    status: 'done',
    senderName: 'Me',
  }

  test('writes one segment for a message within budget', async () => {
    const { ctx, tables } = makeCtx()
    const { segments } = await insertMessage(ctx, fields as never, [text(10)])

    expect(segments).toHaveLength(1)
    expect(tables.messageContents).toHaveLength(1)
    expect(tables.messageContents[0].segmentIndex).toBe(0)
  })

  test('fans an over-budget send out across segment rows', async () => {
    const { ctx, tables } = makeCtx()
    const parts = Array.from({ length: 3 }, () =>
      text(MESSAGE_SPLIT_BUDGET_BYTES),
    )

    const { segments, contentId } = await insertMessage(
      ctx,
      fields as never,
      parts,
    )

    expect(segments).toHaveLength(3)
    expect(tables.messageContents.map((row) => row.segmentIndex)).toEqual([
      0, 1, 2,
    ])
    // Streaming continues in the last row
    expect(contentId).toBe(tables.messageContents[2]._id as never)
    // Nothing is dropped on the way
    expect(segments.flat()).toEqual(parts)
  })

  test('keeps turn metadata on the first row only', async () => {
    const { ctx, tables } = makeCtx()
    const parts = Array.from({ length: 2 }, () =>
      text(MESSAGE_SPLIT_BUDGET_BYTES),
    )

    await insertMessage(
      ctx,
      { ...fields, metadata: { usage: {} } } as never,
      parts,
    )

    expect(tables.messageContents[0].metadata).toEqual({ usage: {} })
    expect(tables.messageContents[1].metadata).toBeUndefined()
  })

  test('rejects a part no row could hold', async () => {
    const { ctx } = makeCtx()

    await expect(
      insertMessage(ctx, fields as never, [text(MAX_MESSAGE_PART_BYTES + 1)]),
    ).rejects.toThrow(/Message part limit exceeded/)
  })
})

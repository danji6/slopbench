/// <reference types="bun-types" />
import type { Doc } from '@sb/convex/_generated/dataModel'
import { joinSegmentsWithinBudget } from '@sb/convex/model/chat'
import { serializedSize } from '@sb/core/utils/size'
import { describe, expect, test } from 'bun:test'

type Row = Record<string, unknown> & {
  messageId: string
  version: number
  segmentIndex: number
  parts: unknown[]
}

/** Fakes just enough of the db for `listSelectedSegments`. */
function fakeCtx(segmentRows: Row[]) {
  return {
    db: {
      query: () => {
        const captured: Record<string, unknown> = {}
        const q = {
          eq: (field: string, value: unknown) => {
            captured[field] = value
            return q
          },
        }
        return {
          withIndex: (_index: string, fn: (query: typeof q) => typeof q) => {
            fn(q)
            return {
              collect: async () =>
                segmentRows
                  .filter(
                    (row) =>
                      row.messageId === captured.messageId &&
                      row.version === captured.version,
                  )
                  .sort((a, b) => a.segmentIndex - b.segmentIndex),
            }
          },
        }
      },
    },
  } as never
}

const doc = (id: string) =>
  ({ _id: id, selectedVersion: 1 }) as unknown as Doc<'messages'>

const text = (value: string) => ({ type: 'text', text: value })
const partSize = serializedSize([text('xxxx')])

function segment(messageId: string, segmentIndex: number): Row {
  return { messageId, version: 1, segmentIndex, parts: [text('xxxx')] }
}

describe('joinSegmentsWithinBudget', () => {
  test('loads every segment when the budget allows', async () => {
    const ctx = fakeCtx([segment('m_1', 0), segment('m_1', 1)])

    const { messages, trimmed } = await joinSegmentsWithinBudget(
      ctx,
      [doc('m_1')],
      1000,
      { direction: 'newer' },
    )

    expect(trimmed).toBe(false)
    expect(messages[0].segments.map((s) => s.segmentIndex)).toEqual([0, 1])
    expect(messages[0].sizeBytes).toBe(partSize * 2)
    expect(messages[0].hasOlderSegments).toBe(false)
    expect(messages[0].hasNewerSegments).toBe(false)
  })

  test('an older-edge budget stop keeps the newest segments', async () => {
    const ctx = fakeCtx([
      segment('m_1', 0),
      segment('m_1', 1),
      segment('m_1', 2),
    ])

    // Walking desc from the anchor: seg2 + seg1 reach the budget
    const { messages, trimmed } = await joinSegmentsWithinBudget(
      ctx,
      [doc('m_1')],
      partSize * 2,
      { direction: 'older' },
    )

    expect(trimmed).toBe(true)
    expect(messages[0].segments.map((s) => s.segmentIndex)).toEqual([1, 2])
    expect(messages[0].hasOlderSegments).toBe(true)
    expect(messages[0].hasNewerSegments).toBe(false)
  })

  test('a newer-edge budget stop keeps the oldest segments', async () => {
    const ctx = fakeCtx([
      segment('m_1', 0),
      segment('m_1', 1),
      segment('m_1', 2),
    ])

    const { messages, trimmed } = await joinSegmentsWithinBudget(
      ctx,
      [doc('m_1')],
      partSize * 2,
      { direction: 'newer' },
    )

    expect(trimmed).toBe(true)
    expect(messages[0].segments.map((s) => s.segmentIndex)).toEqual([0, 1])
    expect(messages[0].hasNewerSegments).toBe(true)
  })

  test('anchorSegment slices the anchor message (older keeps ≤)', async () => {
    const ctx = fakeCtx([
      segment('m_1', 0),
      segment('m_1', 1),
      segment('m_1', 2),
    ])

    const { messages } = await joinSegmentsWithinBudget(
      ctx,
      [doc('m_1')],
      1000,
      { direction: 'older', anchorSegment: 1 },
    )

    expect(messages[0].segments.map((s) => s.segmentIndex)).toEqual([0, 1])
    expect(messages[0].hasNewerSegments).toBe(true)
    expect(messages[0].hasOlderSegments).toBe(false)
  })

  test('anchorSegment slices the anchor message (newer keeps ≥)', async () => {
    const ctx = fakeCtx([
      segment('m_1', 0),
      segment('m_1', 1),
      segment('m_1', 2),
    ])

    const { messages } = await joinSegmentsWithinBudget(
      ctx,
      [doc('m_1')],
      1000,
      { direction: 'newer', anchorSegment: 1 },
    )

    expect(messages[0].segments.map((s) => s.segmentIndex)).toEqual([1, 2])
    expect(messages[0].hasOlderSegments).toBe(true)
    expect(messages[0].hasNewerSegments).toBe(false)
  })

  test('only slices the first (anchor) row', async () => {
    const ctx = fakeCtx([
      segment('m_1', 0),
      segment('m_1', 1),
      segment('m_2', 0),
      segment('m_2', 1),
    ])

    const { messages } = await joinSegmentsWithinBudget(
      ctx,
      [doc('m_1'), doc('m_2')],
      1000,
      { direction: 'newer', anchorSegment: 1 },
    )

    expect(messages[0].segments.map((s) => s.segmentIndex)).toEqual([1])
    expect(messages[1].segments.map((s) => s.segmentIndex)).toEqual([0, 1])
  })

  test('always yields at least one segment before trimming', async () => {
    const ctx = fakeCtx([segment('m_1', 0), segment('m_2', 0)])

    // Budget smaller than a single segment: the anchor segment still loads
    const { messages, trimmed } = await joinSegmentsWithinBudget(
      ctx,
      [doc('m_1'), doc('m_2')],
      1,
      { direction: 'newer' },
    )

    expect(trimmed).toBe(true)
    expect(messages).toHaveLength(1)
    expect(messages[0].segments).toHaveLength(1)
  })

  test('a message with no content rows gets a synthetic empty segment', async () => {
    const ctx = fakeCtx([])

    const { messages, trimmed } = await joinSegmentsWithinBudget(
      ctx,
      [doc('m_1')],
      1000,
      { direction: 'older' },
    )

    expect(trimmed).toBe(false)
    expect(messages[0].segments).toEqual([
      { segmentIndex: 0, parts: [], sizeBytes: 0 },
    ])
  })

  test('strips link snapshots per segment', async () => {
    const link = {
      type: 'file-link',
      fileId: 'f_1',
      snapshot: { huge: 'x'.repeat(100) },
    }
    const ctx = fakeCtx([
      { messageId: 'm_1', version: 1, segmentIndex: 0, parts: [link] },
    ])

    const { messages } = await joinSegmentsWithinBudget(
      ctx,
      [doc('m_1')],
      1000,
      { direction: 'newer' },
    )

    const stripped = { type: 'file-link', fileId: 'f_1' }
    expect(messages[0].segments[0].parts).toEqual([stripped])
    expect(messages[0].segments[0].sizeBytes).toBe(serializedSize([stripped]))
  })

  test('ignores rows from non-selected versions', async () => {
    const ctx = fakeCtx([
      segment('m_1', 0),
      { messageId: 'm_1', version: 2, segmentIndex: 0, parts: [text('old')] },
    ])

    const { messages } = await joinSegmentsWithinBudget(
      ctx,
      [doc('m_1')],
      1000,
      { direction: 'newer' },
    )

    expect(messages[0].segments).toHaveLength(1)
    expect(messages[0].segments[0].parts).toEqual([text('xxxx')])
  })
})

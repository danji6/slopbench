/// <reference types="bun-types" />
import {
  type RetainedState,
  limitRetained,
  mergeRetained,
} from '@sb/client/lib/chat/message-merge'
import type { MessageRecord, PartMetadata } from '@sb/client/lib/chat/types'
import type { UIMessage } from 'ai'
import { describe, expect, test } from 'bun:test'

const message = (id: string): UIMessage => ({ id, role: 'user', parts: [] })
const record = (id: string): MessageRecord =>
  ({
    sender: { type: 'user', id },
    selectedVersion: 1,
    sizeBytes: 0,
    segments: [{ index: 0, partCount: 0, sizeBytes: 0 }],
    hasOlderSegments: false,
    hasNewerSegments: false,
  }) as unknown as MessageRecord
const partMeta = (): PartMetadata => ({}) as PartMetadata

function retained(ids: string[]): RetainedState {
  return {
    ids,
    messagesById: new Map(ids.map((id) => [id, message(id)])),
    messageMetaByMessage: new Map(ids.map((id) => [id, record(id)])),
    partMetaByMessage: new Map(ids.map((id) => [id, partMeta()])),
  }
}

function input(ids: string[]) {
  return {
    results: ids.map(message),
    messageMetaByMessage: new Map(ids.map((id) => [id, record(id)])),
    partMetaByMessage: new Map(ids.map((id) => [id, partMeta()])),
  }
}

const idsOf = (result: { results: UIMessage[] }) =>
  result.results.map((m) => m.id)

describe('mergeRetained', () => {
  test('grows the tail when a new message arrives', () => {
    const merged = mergeRetained(
      retained(['A', 'B', 'C']),
      input(['B', 'C', 'D']),
    )
    expect(idsOf(merged)).toEqual(['A', 'B', 'C', 'D'])
  })

  test('keeps multiple retained-older ids across a slide', () => {
    const merged = mergeRetained(
      retained(['A', 'B', 'C', 'D']),
      input(['C', 'D', 'E']),
    )
    expect(idsOf(merged)).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  test('passes the page through unchanged when it already includes the head', () => {
    const next = input(['A', 'B', 'C', 'D', 'E'])
    const merged = mergeRetained(retained(['C', 'D', 'E']), next)
    expect(merged).toBe(next)
  })

  test('drops an in-window deletion while keeping older ids', () => {
    // C deleted: the newest page no longer contains it
    const merged = mergeRetained(
      retained(['A', 'B', 'C', 'D', 'E']),
      input(['B', 'D', 'E']),
    )
    expect(idsOf(merged)).toEqual(['A', 'B', 'D', 'E'])
  })

  test('replaces when the page does not overlap the retained set', () => {
    const next = input(['X', 'Y', 'Z'])
    const merged = mergeRetained(retained(['A', 'B']), next)
    expect(merged).toBe(next)
  })

  test('carries metadata for the retained-older ids', () => {
    const merged = mergeRetained(
      retained(['A', 'B', 'C']),
      input(['B', 'C', 'D']),
    )
    expect(merged.messageMetaByMessage.has('A')).toBe(true)
    expect(merged.partMetaByMessage.has('A')).toBe(true)
    expect(merged.messageMetaByMessage.has('D')).toBe(true)
  })
})

describe('mergeRetained boundary segments', () => {
  const part = (text: string) => ({ type: 'text', text })

  function segmented(
    id: string,
    slices: Array<{ index: number; texts: string[] }>,
    overrides: Partial<MessageRecord> = {},
  ) {
    return {
      message: {
        id,
        role: 'assistant',
        parts: slices.flatMap((slice) => slice.texts.map(part)),
      } as UIMessage,
      record: {
        sender: { type: 'agent', id: 'agent_1' },
        selectedVersion: 1,
        sizeBytes: slices.reduce(
          (sum, slice) => sum + slice.texts.join('').length,
          0,
        ),
        segments: slices.map((slice) => ({
          index: slice.index,
          partCount: slice.texts.length,
          sizeBytes: slice.texts.join('').length,
        })),
        hasOlderSegments: false,
        hasNewerSegments: false,
        ...overrides,
      } as unknown as MessageRecord,
    }
  }

  function stateFor(
    entries: ReadonlyArray<readonly [string, ReturnType<typeof segmented>]>,
  ) {
    const retainedState: RetainedState = {
      ids: entries.map(([id]) => id),
      messagesById: new Map(entries.map(([id, e]) => [id, e.message])),
      messageMetaByMessage: new Map(entries.map(([id, e]) => [id, e.record])),
      partMetaByMessage: new Map(entries.map(([id]) => [id, partMeta()])),
    }
    return retainedState
  }

  function inputFor(
    entries: ReadonlyArray<readonly [string, ReturnType<typeof segmented>]>,
  ) {
    return {
      results: entries.map(([, e]) => e.message),
      messageMetaByMessage: new Map(entries.map(([id, e]) => [id, e.record])),
      partMetaByMessage: new Map(
        entries.map(([id]) => [id, partMeta()] as const),
      ),
    }
  }

  test('prepends retained older segments when the live window trims them', () => {
    const prev = stateFor([
      [
        'S',
        segmented('S', [
          { index: 0, texts: ['a', 'b'] },
          { index: 1, texts: ['c'] },
        ]),
      ],
    ])
    const next = inputFor([
      [
        'S',
        segmented(
          'S',
          [
            { index: 1, texts: ['c'] },
            { index: 2, texts: ['d'] },
          ],
          { hasOlderSegments: true },
        ),
      ],
    ])

    const merged = mergeRetained(prev, next)

    expect(
      merged.results[0].parts.map((p) => (p as { text: string }).text),
    ).toEqual(['a', 'b', 'c', 'd'])
    expect(merged.messageMetaByMessage.get('S')?.segments).toEqual([
      { index: 0, partCount: 2, sizeBytes: 2 },
      { index: 1, partCount: 1, sizeBytes: 1 },
      { index: 2, partCount: 1, sizeBytes: 1 },
    ])
    // The retained set had the turn's start loaded
    expect(merged.messageMetaByMessage.get('S')?.hasOlderSegments).toBe(false)
  })

  test('a version change (retry) takes the incoming content wholesale', () => {
    const prev = stateFor([
      [
        'S',
        segmented('S', [
          { index: 0, texts: ['a'] },
          { index: 1, texts: ['b'] },
        ]),
      ],
    ])
    const next = inputFor([
      [
        'S',
        segmented('S', [{ index: 0, texts: ['regenerated'] }], {
          selectedVersion: 2,
        }),
      ],
    ])

    const merged = mergeRetained(prev, next)

    expect(
      merged.results[0].parts.map((p) => (p as { text: string }).text),
    ).toEqual(['regenerated'])
    expect(merged.messageMetaByMessage.get('S')?.segments).toEqual([
      { index: 0, partCount: 1, sizeBytes: 11 },
    ])
  })

  test('does not duplicate segments already present in the incoming page', () => {
    const shape = segmented('S', [
      { index: 0, texts: ['a'] },
      { index: 1, texts: ['b'] },
    ])
    const prev = stateFor([['S', shape]])
    const next = inputFor([['S', shape]])

    const merged = mergeRetained(prev, next)

    expect(merged).toBe(next)
  })

  describe('limitRetained', () => {
    test('drops the oldest messages once the retained byte budget is full', () => {
      const entries = ['A', 'B', 'C'].map(
        (id) =>
          [id, segmented(id, [{ index: 0, texts: [id.repeat(4)] }])] as const,
      )

      const limited = limitRetained(inputFor(entries), {
        maxBytes: 8,
        maxMessages: 10,
      })

      expect(idsOf(limited)).toEqual(['B', 'C'])
      expect([...limited.messageMetaByMessage]).toHaveLength(2)
      expect([...limited.partMetaByMessage]).toHaveLength(2)
    })

    test('trims old segments from a single long-running turn', () => {
      const longTurn = segmented('S', [
        { index: 0, texts: ['aa', 'bb'] },
        { index: 1, texts: ['cccc'] },
        { index: 2, texts: ['dddd'] },
      ])

      const limited = limitRetained(inputFor([['S', longTurn]]), {
        maxBytes: 8,
        maxMessages: 10,
      })

      expect(limited.results[0].parts).toEqual([
        { type: 'text', text: 'cccc' },
        { type: 'text', text: 'dddd' },
      ])
      expect(limited.messageMetaByMessage.get('S')).toMatchObject({
        sizeBytes: 8,
        hasOlderSegments: true,
        segments: [
          { index: 1, partCount: 1, sizeBytes: 4 },
          { index: 2, partCount: 1, sizeBytes: 4 },
        ],
      })
    })

    test('keeps one oversized newest segment so the window is never empty', () => {
      const latest = segmented('S', [{ index: 0, texts: ['oversized'] }])

      const limited = limitRetained(inputFor([['S', latest]]), {
        maxBytes: 1,
        maxMessages: 10,
      })

      expect(idsOf(limited)).toEqual(['S'])
      expect(limited.results[0].parts).toHaveLength(1)
    })
  })
})

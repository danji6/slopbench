/// <reference types="bun-types" />
import {
  type MessageStoreInput,
  createMessageStore,
} from '@sb/client/lib/chat/message-store'
import type { MessageRecord, PartMetadata } from '@sb/client/lib/chat/types'
import { MESSAGE_PAGE_BUDGET_BYTES } from '@sb/core/const'
import type { UIMessage } from 'ai'
import { describe, expect, test } from 'bun:test'

const message = (id: string): UIMessage => ({
  id,
  role: 'assistant',
  parts: [{ type: 'text', text: id }],
})

const record = (id: string): MessageRecord =>
  ({
    sender: { type: 'agent', id: 'agent_1' },
    _id: id,
    selectedVersion: 1,
    segments: [{ index: 0, partCount: 1 }],
    hasOlderSegments: false,
    hasNewerSegments: false,
  }) as unknown as MessageRecord

function input(ids: string[]): MessageStoreInput {
  return {
    sessionId: 'session_1',
    results: ids.map(message),
    controls: {
      extendOlder: () => false,
      extendNewer: () => false,
      returnToLatest: () => {},
      returnToOldest: () => {},
      anchorAround: () => {},
    },
    meta: {
      isLoadingFirstPage: false,
      canLoadOlder: false,
      canLoadNewer: false,
      isAtLiveTail: true,
      isLoadingOlder: false,
      isLoadingNewer: false,
      isSliding: false,
    },
    resetKey: 0,
    messageMetaByMessage: new Map(ids.map((id) => [id, record(id)])),
    partMetaByMessage: new Map(ids.map((id) => [id, {} as PartMetadata])),
    groupBySender: false,
  }
}

function segmentedInput(indices: number[]): MessageStoreInput {
  const messageId = 'streaming-message'
  const sizeBytes = indices.length * MESSAGE_PAGE_BUDGET_BYTES
  return {
    ...input([messageId]),
    results: [
      {
        ...message(messageId),
        parts: indices.map((index) => ({ type: 'text', text: String(index) })),
      },
    ],
    messageMetaByMessage: new Map([
      [
        messageId,
        {
          ...record(messageId),
          sizeBytes,
          segments: indices.map((index) => ({
            index,
            partCount: 1,
            sizeBytes: MESSAGE_PAGE_BUDGET_BYTES,
          })),
          hasOlderSegments: indices[0] > 0,
        },
      ],
    ]),
  }
}

describe('message store evict', () => {
  test('removes a message retained past the live window', () => {
    const store = createMessageStore()
    store.sync(input(['A', 'B', 'C']))
    // A slides out of the live window but stays retained
    store.sync(input(['B', 'C']))
    expect(store.getIds()).toEqual(['A', 'B', 'C'])

    store.evict('A')

    expect(store.getIds()).toEqual(['B', 'C'])
    expect(store.getMessage('A')).toBeNull()
    expect(store.getMessageMetadata('A')).toBeUndefined()
    expect(store.getRows().some((row) => row.messageId === 'A')).toBe(false)
  })

  test('notifies subscribers', () => {
    const store = createMessageStore()
    store.sync(input(['A', 'B']))

    let notified = 0
    store.subscribe(() => notified++)
    store.evict('A')

    expect(notified).toBe(1)
    expect(store.getIds()).toEqual(['B'])
  })

  test('ignores unknown ids without notifying', () => {
    const store = createMessageStore()
    store.sync(input(['A']))

    let notified = 0
    store.subscribe(() => notified++)
    store.evict('missing')

    expect(notified).toBe(0)
    expect(store.getIds()).toEqual(['A'])
  })

  test('does not resurrect an evicted message on the next sync', () => {
    const store = createMessageStore()
    store.sync(input(['A', 'B', 'C']))
    store.sync(input(['B', 'C']))
    store.evict('A')

    // The live page updates again; A must stay gone
    store.sync(input(['B', 'C', 'D']))
    expect(store.getIds()).toEqual(['B', 'C', 'D'])
  })

  test('caps messages retained across overlapping live pages', () => {
    const store = createMessageStore()
    const initial = Array.from({ length: 160 }, (_, index) => `M${index}`)
    store.sync(input(initial))

    store.sync(input([...initial.slice(1), 'M160']))

    expect(store.getIds()).toHaveLength(160)
    expect(store.getIds()[0]).toBe('M1')
    expect(store.getIds().at(-1)).toBe('M160')
  })

  test('caps segments retained from one long-running turn', () => {
    const store = createMessageStore()
    store.sync(segmentedInput([0, 1, 2, 3]))

    store.sync(segmentedInput([2, 3, 4, 5]))

    expect(store.getMessage('streaming-message')?.parts).toEqual([
      { type: 'text', text: '2' },
      { type: 'text', text: '3' },
      { type: 'text', text: '4' },
      { type: 'text', text: '5' },
    ])
    expect(store.getMessageMetadata('streaming-message')).toMatchObject({
      hasOlderSegments: true,
      segments: [{ index: 2 }, { index: 3 }, { index: 4 }, { index: 5 }],
    })
    expect(store.getMessageMetadata('streaming-message')?.sizeBytes).toBe(
      MESSAGE_PAGE_BUDGET_BYTES * 4,
    )
  })
})

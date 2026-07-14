/// <reference types="bun-types" />
import {
  type MessageStoreInput,
  createMessageStore,
} from '@sb/client/lib/chat/message-store'
import type { MessageRecord, PartMetadata } from '@sb/client/lib/chat/types'
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
})

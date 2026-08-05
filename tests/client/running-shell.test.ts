/// <reference types="bun-types" />
import {
  type MessageStoreInput,
  createMessageStore,
} from '@sb/client/lib/chat/message-store'
import { runningShellSender } from '@sb/client/lib/chat/messages'
import type { MessageRecord, PartMetadata } from '@sb/client/lib/chat/types'
import type { UIMessage } from 'ai'
import { describe, expect, test } from 'bun:test'

type ShellState = 'input-available' | 'output-available'

const shellMessage = (
  id: string,
  state: ShellState,
  preliminary?: boolean,
): UIMessage => ({
  id,
  role: 'user',
  parts: [
    {
      type: 'tool-shell',
      toolCallId: `call_${id}`,
      state,
      input: { command: 'sleep 60' },
      ...(state === 'output-available' && {
        output: { status: 'running' },
        preliminary,
      }),
    } as unknown as UIMessage['parts'][number],
  ],
})

const textMessage = (id: string): UIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text: id }],
})

function input(messages: UIMessage[], senderId = 'user_1'): MessageStoreInput {
  const ids = messages.map((message) => message.id)
  return {
    sessionId: 'session_1',
    results: messages,
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
    messageMetaByMessage: new Map(
      ids.map((id) => [
        id,
        {
          sender: { type: 'user', id: senderId },
          selectedVersion: 1,
          segments: [{ index: 0, partCount: 1 }],
          hasOlderSegments: false,
          hasNewerSegments: false,
        } as unknown as MessageRecord,
      ]),
    ),
    partMetaByMessage: new Map(ids.map((id) => [id, {} as PartMetadata])),
    groupBySender: false,
  }
}

function storeWith(messages: UIMessage[], senderId?: string) {
  const store = createMessageStore()
  store.sync(input(messages, senderId))
  return store
}

describe('runningShellSender', () => {
  // A user command has no stream, so this is what tells the list to follow it
  test('reports the sender while the command is still pending', () => {
    const store = storeWith([shellMessage('A', 'input-available')])
    expect(runningShellSender(store)).toBe('user_1')
  })

  test('keeps reporting while the output is preliminary', () => {
    const store = storeWith([shellMessage('A', 'output-available', true)])
    expect(runningShellSender(store)).toBe('user_1')
  })

  test('stops once the command settles', () => {
    const store = storeWith([shellMessage('A', 'output-available')])
    expect(runningShellSender(store)).toBeNull()
  })

  test('only looks at the tail message', () => {
    const store = storeWith([
      shellMessage('A', 'input-available'),
      textMessage('B'),
    ])
    expect(runningShellSender(store)).toBeNull()
  })

  test('has no sender without messages', () => {
    expect(runningShellSender(createMessageStore())).toBeNull()
  })
})

/// <reference types="bun-types" />
import {
  convertMessages,
  isMessagePending,
  isMessageStreaming,
  messageStructureSignature,
  sanitizeMessages,
} from '@/lib/chat/messages'
import {
  isEmptyAssistantMessage,
  removeEmptyAssistantMessages,
  shouldSaveSubmittedPrompt,
} from '@sb/convex/model/messages'
import type { UIMessage } from 'ai'
import { describe, expect, test } from 'bun:test'

const emptyAssistant = {
  id: 'empty',
  role: 'assistant',
  parts: [],
} as never

describe('chat message visibility', () => {
  test('removes an empty assistant placeholder from visible messages', () => {
    const user = { id: 'user', role: 'user', parts: [] } as never

    expect(removeEmptyAssistantMessages([user, emptyAssistant])).toEqual([user])
  })

  test('keeps assistant output once text exists', () => {
    const assistant = {
      id: 'assistant',
      role: 'assistant',
      parts: [{ type: 'text', text: 'answer' }],
    } as never

    expect(isEmptyAssistantMessage(assistant)).toBe(false)
  })

  test('finalizes dangling streaming text parts after abort', () => {
    const [message] = sanitizeMessages([
      {
        id: 'assistant',
        role: 'assistant',
        parts: [{ type: 'text', text: 'partial', state: 'streaming' }],
      } as UIMessage,
    ])

    expect(message).toBeDefined()
    expect(isMessageStreaming(message)).toBe(false)
    expect(message?.parts[0]).toMatchObject({ state: 'done' })
  })

  test('finalizes dangling tool input parts after abort', () => {
    const [message] = sanitizeMessages([
      {
        id: 'assistant',
        role: 'assistant',
        parts: [
          {
            type: 'tool-test',
            toolCallId: 'call-1',
            state: 'input-streaming',
            input: {},
          },
        ],
      } as unknown as UIMessage,
    ])

    expect(message?.parts[0]).toMatchObject({ state: 'output-error' })
  })

  test('projects done messages with finalized streamed parts', () => {
    const { messages } = convertMessages([
      {
        _id: 'assistant',
        _creationTime: 1,
        sessionId: 'session',
        role: 'assistant',
        sender: { type: 'agent', id: 'agent' },
        senderSnapshot: { name: 'Assistant' },
        status: 'done',
        segments: [
          {
            segmentIndex: 0,
            parts: [{ type: 'text', text: 'partial', state: 'streaming' }],
          },
        ],
        hasOlderSegments: false,
        hasNewerSegments: false,
      } as never,
    ])

    expect(isMessageStreaming(messages[0])).toBe(false)
    expect(messages[0]?.parts[0]).toMatchObject({ state: 'done' })
  })

  test('concatenates loaded segments into the flat parts list', () => {
    const { messages, byId } = convertMessages([
      {
        _id: 'assistant',
        _creationTime: 1,
        sessionId: 'session',
        role: 'assistant',
        sender: { type: 'agent', id: 'agent' },
        status: 'done',
        segments: [
          { segmentIndex: 1, parts: [{ type: 'text', text: 'middle' }] },
          {
            segmentIndex: 2,
            parts: [
              { type: 'text', text: 'end a' },
              { type: 'text', text: 'end b' },
            ],
          },
        ],
        hasOlderSegments: true,
        hasNewerSegments: false,
      } as never,
    ])

    expect(
      messages[0]?.parts.map((part) => (part as { text: string }).text),
    ).toEqual(['middle', 'end a', 'end b'])
    expect(byId.get('assistant')).toMatchObject({
      segments: [
        { index: 1, partCount: 1 },
        { index: 2, partCount: 2 },
      ],
      hasOlderSegments: true,
    })
  })

  test('projects shared sender appearance metadata', () => {
    const { byId } = convertMessages([
      {
        _id: 'user',
        _creationTime: 1,
        sessionId: 'session',
        role: 'user',
        sender: { type: 'user', id: 'user' },
        senderSnapshot: {
          name: 'User',
          css: '.usr { opacity: 0.9; }',
          theme: { source: '#123456', light: {}, dark: {} },
        },
        status: 'done',
        segments: [
          { segmentIndex: 0, parts: [{ type: 'text', text: 'hello' }] },
        ],
        hasOlderSegments: false,
        hasNewerSegments: false,
      } as never,
    ])

    expect(byId.get('user')).toMatchObject({
      sender: { type: 'user', id: 'user' },
      senderSnapshot: {
        css: '.usr { opacity: 0.9; }',
        theme: { source: '#123456', light: {}, dark: {} },
      },
    })
  })

  test('keeps processing assistant pending until rendered content exists', () => {
    expect(
      isMessagePending({
        id: 'assistant',
        role: 'assistant',
        status: 'processing',
        parts: [{ type: 'step-start' }],
      } as unknown as UIMessage),
    ).toBe(true)

    expect(
      isMessagePending({
        id: 'assistant',
        role: 'assistant',
        status: 'processing',
        parts: [{ type: 'reasoning', text: '', state: 'streaming' }],
      } as unknown as UIMessage),
    ).toBe(true)

    expect(
      isMessagePending({
        id: 'assistant',
        role: 'assistant',
        status: 'processing',
        parts: [{ type: 'reasoning', text: 'thinking', state: 'streaming' }],
      } as unknown as UIMessage),
    ).toBe(false)
  })
})

describe('message structure signature (grow-only re-settle key)', () => {
  const withParts = (parts: unknown[]) =>
    ({ id: 'm', role: 'assistant', parts }) as unknown as UIMessage

  test('ignores text growth so grow-only keeps clamping during streaming', () => {
    const before = messageStructureSignature(
      withParts([{ type: 'text', text: 'Ed', state: 'streaming' }]),
    )
    const after = messageStructureSignature(
      withParts([
        { type: 'text', text: 'Edit the file …', state: 'streaming' },
      ]),
    )

    expect(after).toBe(before)
  })

  test('changes when a tool part errors mid-stream so the row can shrink', () => {
    const streaming = messageStructureSignature(
      withParts([
        { type: 'text', text: 'Edit …', state: 'done' },
        { type: 'tool-edit_file', state: 'input-streaming' },
      ]),
    )
    const errored = messageStructureSignature(
      withParts([
        { type: 'text', text: 'Edit …', state: 'done' },
        { type: 'tool-edit_file', state: 'output-error' },
      ]),
    )

    expect(errored).not.toBe(streaming)
  })

  test('changes when a new part is appended', () => {
    const before = messageStructureSignature(
      withParts([{ type: 'tool-edit_file', state: 'output-error' }]),
    )
    const after = messageStructureSignature(
      withParts([
        { type: 'tool-edit_file', state: 'output-error' },
        { type: 'reasoning', text: 'Thought', state: 'done' },
      ]),
    )

    expect(after).not.toBe(before)
  })
})

describe('empty submission regeneration', () => {
  test('does not save a user prompt for an empty regeneration request', () => {
    expect(shouldSaveSubmittedPrompt('', 0, true)).toBe(false)
  })

  test('never drops non-empty submitted text', () => {
    expect(shouldSaveSubmittedPrompt('hello', 0, true)).toBe(true)
    expect(shouldSaveSubmittedPrompt('', 0, false)).toBe(true)
  })

  test('saves message for file-only submissions even when regenerate is set', () => {
    expect(shouldSaveSubmittedPrompt('', 1, true)).toBe(true)
    expect(shouldSaveSubmittedPrompt('', 2, true)).toBe(true)
  })
})

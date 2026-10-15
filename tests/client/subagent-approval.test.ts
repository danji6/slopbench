import { optimisticallyRespondApproval } from '@/lib/chat/approval-optimistic'
import { api } from '@sb/convex/_generated/api'
import { expect, test } from 'bun:test'
import { getFunctionName } from 'convex/server'

test('responding to a child advances its approval queue without touching other streams', () => {
  const part = (toolCallId: string) => ({
    type: 'tool-shell',
    toolCallId,
    state: 'approval-requested',
    approval: { id: toolCallId },
  })
  let requests = [
    { sessionId: 'child_1', parts: [part('first'), part('second')] },
    { sessionId: 'child_2', parts: [part('first')] },
  ]
  const store = {
    getQuery: (query: never) => {
      expect(getFunctionName(query)).toBe(
        getFunctionName(api.subagents.pendingApprovals),
      )
      return requests
    },
    setQuery: (query: never, args: unknown, value: typeof requests) => {
      expect(getFunctionName(query)).toBe(
        getFunctionName(api.subagents.pendingApprovals),
      )
      expect(args).toEqual({ sessionId: 'parent' })
      requests = value
    },
  } as never

  optimisticallyRespondApproval(store, {
    sessionId: 'parent' as never,
    childSessionId: 'child_1' as never,
    toolCallId: 'first',
    approved: true,
  })
  expect(requests).toEqual([
    { sessionId: 'child_1', parts: [part('second')] },
    { sessionId: 'child_2', parts: [part('first')] },
  ])
  optimisticallyRespondApproval(store, {
    sessionId: 'parent' as never,
    childSessionId: 'child_1' as never,
    toolCallId: 'second',
    approved: false,
  })
  expect(requests).toEqual([{ sessionId: 'child_2', parts: [part('first')] }])
})

test('root approval responses keep other pending calls and update only the active message', () => {
  let stream = { status: 'awaiting_approval', processingMessageId: 'message' }
  let window = {
    page: [
      {
        _id: 'message',
        segments: [
          {
            parts: [
              {
                type: 'tool-shell',
                state: 'approval-requested',
                toolCallId: 'first',
              },
              {
                type: 'tool-write_file',
                state: 'approval-requested',
                toolCallId: 'second',
              },
              { type: 'text', state: 'approval-requested' },
            ] as unknown[],
          },
        ],
      },
    ],
  }
  const store = {
    getQuery: () => stream,
    getAllQueries: () => [{ args: { sessionId: 'root' }, value: window }],
    setQuery: (query: never, _args: unknown, value: never) => {
      if (getFunctionName(query) === getFunctionName(api.chat.getActiveStream))
        stream = value
      else window = value
    },
  } as never
  optimisticallyRespondApproval(store, {
    sessionId: 'root' as never,
    toolCallId: 'first',
    approved: true,
  })
  expect(stream.status).toBe('awaiting_approval')
  expect(window.page[0].segments[0].parts[0]).toMatchObject({
    state: 'approval-responded',
  })
  optimisticallyRespondApproval(store, {
    sessionId: 'root' as never,
    toolCallId: 'second',
    approved: false,
  })
  expect(stream.status).toBe('pending')
  expect(window.page[0].segments[0].parts[1]).toMatchObject({
    state: 'output-denied',
  })
})

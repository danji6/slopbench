import { optimisticallyRespondApproval } from '@/lib/chat/approval-optimistic'
import { api } from '@sb/convex/_generated/api'
import { expect, test } from 'bun:test'
import type { OptimisticLocalStore } from 'convex/browser'
import { type FunctionReference, getFunctionName } from 'convex/server'

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
      return getFunctionName(query) ===
        getFunctionName(api.subagents.pendingApprovals)
        ? requests
        : undefined
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
    getQuery: (query: never) =>
      getFunctionName(query) === getFunctionName(api.chat.getActiveStream)
        ? stream
        : undefined,
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

type QueryEntry = {
  query: FunctionReference<'query'>
  args: Record<string, unknown>
  value: unknown
}

function approvalStore(entries: QueryEntry[]) {
  const matches = (entry: QueryEntry, query: FunctionReference<'query'>) =>
    getFunctionName(entry.query) === getFunctionName(query)
  const store = {
    getQuery(query: FunctionReference<'query'>, args: unknown) {
      return entries.find(
        (entry) =>
          matches(entry, query) &&
          JSON.stringify(entry.args) === JSON.stringify(args),
      )?.value
    },
    getAllQueries(query: FunctionReference<'query'>) {
      return entries.filter((entry) => matches(entry, query))
    },
    setQuery(
      query: FunctionReference<'query'>,
      args: Record<string, unknown>,
      value: unknown,
    ) {
      const entry = entries.find(
        (entry) =>
          matches(entry, query) &&
          JSON.stringify(entry.args) === JSON.stringify(args),
      )
      if (entry) entry.value = value
      else entries.push({ query, args, value })
    },
  }
  return store as unknown as OptimisticLocalStore
}

test('child responses synchronize the parent queue and live child transcript', () => {
  const part = (toolCallId: string) => ({
    type: 'tool-shell',
    toolCallId,
    state: 'approval-requested',
    approval: { id: toolCallId },
  })
  const entries: QueryEntry[] = [
    {
      query: api.subagents.pendingApprovals,
      args: { sessionId: 'parent' },
      value: [
        { sessionId: 'child', parts: [part('first'), part('second')] },
        { sessionId: 'sibling', parts: [part('first')] },
      ],
    },
    ...['parent', 'child', 'sibling'].flatMap((sessionId) => [
      {
        query: api.chat.getActiveStream,
        args: { sessionId },
        value: {
          status: 'awaiting_approval',
          processingMessageId: `${sessionId}_message`,
        },
      },
      {
        query: api.chat.messagesWindow,
        args: { sessionId, anchor: null },
        value: {
          page: [
            {
              _id: `${sessionId}_message`,
              selectedVersion: 1,
              segments: [
                { segmentIndex: 0, live: true, parts: [], sizeBytes: 0 },
              ],
            },
          ],
        },
      },
      {
        query: api.chat.processingMessageSegments,
        args: { sessionId },
        value: [
          {
            messageId: `${sessionId}_message`,
            selectedVersion: 1,
            segment: {
              segmentIndex: 0,
              parts: [part('first'), part('second')],
              sizeBytes: 100,
            },
          },
        ],
      },
    ]),
  ]
  const untouched = structuredClone(
    entries
      .slice(1)
      .filter((entry) => entry.args.sessionId !== 'child')
      .map(({ args, value }) => ({ args, value })),
  )
  const store = approvalStore(entries)
  const args = {
    sessionId: 'parent' as never,
    childSessionId: 'child' as never,
  }
  const childArgs = { sessionId: 'child' as never }
  optimisticallyRespondApproval(store, {
    ...args,
    toolCallId: 'first',
    approved: true,
    note: 'Use the test remote',
  })
  expect(store.getQuery(api.chat.getActiveStream, childArgs)?.status).toBe(
    'awaiting_approval',
  )
  expect(
    store.getQuery(api.chat.processingMessageSegments, childArgs)?.[0].segment
      .parts,
  ).toMatchObject([
    { state: 'approval-responded', approval: { note: 'Use the test remote' } },
    { state: 'approval-requested' },
  ])
  optimisticallyRespondApproval(store, {
    ...args,
    toolCallId: 'second',
    approved: false,
    reason: 'Denied by user.',
  })
  expect(store.getQuery(api.chat.getActiveStream, childArgs)?.status).toBe(
    'pending',
  )
  expect<unknown>(
    store.getQuery(api.subagents.pendingApprovals, {
      sessionId: 'parent' as never,
    }),
  ).toEqual([{ sessionId: 'sibling', parts: [part('first')] }])
  expect(
    entries.slice(1).filter((entry) => entry.args.sessionId !== 'child'),
  ).toMatchObject(untouched)
})

test.each([false, true])(
  'does not advance a child stream with unloaded parts (window: %s)',
  (hasWindow) => {
    const stream = {
      status: 'awaiting_approval',
      processingMessageId: 'child_message',
    }
    const store = approvalStore([
      {
        query: api.chat.getActiveStream,
        args: { sessionId: 'child' },
        value: stream,
      },
      ...(hasWindow
        ? [
            {
              query: api.chat.messagesWindow,
              args: { sessionId: 'child' },
              value: {
                page: [
                  {
                    _id: 'child_message',
                    selectedVersion: 1,
                    segments: [
                      { segmentIndex: 0, parts: [], sizeBytes: 0, live: true },
                    ],
                  },
                ],
              },
            },
          ]
        : []),
    ])
    optimisticallyRespondApproval(store, {
      sessionId: 'parent' as never,
      childSessionId: 'child' as never,
      toolCallId: 'first',
      approved: true,
    })
    expect<unknown>(
      store.getQuery(api.chat.getActiveStream, { sessionId: 'child' as never }),
    ).toEqual(stream)
  },
)

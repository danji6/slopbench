/// <reference types="bun-types" />
import { _getProviderHistory } from '@sb/convex/model/stream/reads'
import { describe, expect, test } from 'bun:test'

type ContentRow = { _id: string; segmentIndex: number; parts: unknown[] }

type HistoryFixture = {
  stream: Record<string, unknown>
  current: Record<string, unknown> | null
  /** Done, context-eligible messages returned by the history index query. */
  doneMessages: Array<Record<string, unknown>>
  summary?: Record<string, unknown> | null
  /** Segment rows per message id, keyed by version number (ascending). */
  segmentsByMessage: Record<string, Record<number, ContentRow[]>>
}

function historyCtx(fixture: HistoryFixture) {
  const { stream, current, doneMessages, summary } = fixture

  const resultFor = (
    table: string,
    index: string,
    captured: Record<string, unknown>,
  ) => {
    const obj = {
      order: () => obj,
      first: async () =>
        table === 'messages' && index === 'by_sessionId_type_status'
          ? (summary ?? null)
          : null,
      collect: async () => {
        if (
          table === 'messages' &&
          index === 'by_sessionId_status_contextEligible'
        ) {
          return doneMessages
        }
        if (table === 'messageContents') {
          const byMessage =
            fixture.segmentsByMessage[captured.messageId as string]
          return byMessage?.[captured.version as number] ?? []
        }
        return []
      },
      unique: async () => null,
    }
    return obj
  }

  return {
    db: {
      get: async (id: string) => {
        if (id === stream._id) return stream
        if (id === stream.processingMessageId) return current
        return null
      },
      query: (table: string) => ({
        withIndex: (index: string, fn?: (q: unknown) => unknown) => {
          const captured: Record<string, unknown> = {}
          const q = {
            eq: (field: string, value: unknown) => {
              captured[field] = value
              return q
            },
            gte: () => q,
            lte: () => q,
          }
          fn?.(q)
          return resultFor(table, index, captured)
        },
      }),
    },
  } as never
}

describe('_getProviderHistory', () => {
  const userMessage = {
    _id: 'm_user',
    _creationTime: 100,
    role: 'user',
    selectedVersion: 1,
  }
  const userRow = {
    _id: 'c_user_1',
    segmentIndex: 0,
    parts: [{ type: 'text', text: 'write the file' }],
  }
  // A retried assistant turn: a new version was appended and selected, holding
  // the just-approved tool call that the next step must see to continue.
  const retryMessage = {
    _id: 'm_current',
    _creationTime: 200,
    role: 'assistant',
    selectedVersion: 2,
  }
  const retryRow = {
    _id: 'c_current_2',
    segmentIndex: 0,
    parts: [
      {
        type: 'tool-write_file',
        toolCallId: 'call_1',
        state: 'approval-responded',
        input: { path: 'magic.txt' },
      },
    ],
  }

  const baseFixture = (operation: string): HistoryFixture => ({
    stream: {
      _id: 'stream_1',
      sessionId: 'session_1',
      processingMessageId: 'm_current',
      processingContentId: 'c_current_2',
      operation,
      contextBoundaryCreationTime: 150,
    },
    current: retryMessage,
    doneMessages: [userMessage],
    segmentsByMessage: {
      m_user: { 1: [userRow] },
      m_current: { 2: [retryRow] },
    },
  })

  test('includes the in-progress message for a retry stream', async () => {
    const ctx = historyCtx(baseFixture('retry'))

    const history = await _getProviderHistory(ctx, {
      streamId: 'stream_1' as never,
    })

    expect(history.map((m) => m._id)).toEqual([
      'm_user' as never,
      'm_current' as never,
    ])
    // The current turn carries its processing version's (approved) tool parts,
    // so the model sees the call it already made instead of re-proposing it.
    expect(history.at(-1)?.parts).toEqual(retryRow.parts)
  })

  test('includes the in-progress message for an invoke stream', async () => {
    const ctx = historyCtx(baseFixture('invoke'))

    const history = await _getProviderHistory(ctx, {
      streamId: 'stream_1' as never,
    })

    expect(history.map((m) => m._id)).toEqual([
      'm_user' as never,
      'm_current' as never,
    ])
  })

  test('omits the in-progress message for non-generative operations', async () => {
    const ctx = historyCtx(baseFixture('compact'))

    const history = await _getProviderHistory(ctx, {
      streamId: 'stream_1' as never,
    })

    expect(history.map((m) => m._id)).toEqual(['m_user' as never])
  })

  test('concatenates the segments of an in-flight split turn', async () => {
    const call = {
      type: 'tool-write_file',
      toolCallId: 'call_1',
      state: 'output-available',
      input: {},
      output: 'ok',
    }
    const fixture = baseFixture('invoke')
    fixture.current = {
      _id: 'm_current',
      _creationTime: 200,
      role: 'assistant',
      selectedVersion: 1,
    }
    fixture.stream.processingContentId = 'c_seg2'
    fixture.segmentsByMessage.m_current = {
      1: [
        {
          _id: 'c_seg0',
          segmentIndex: 0,
          parts: [{ type: 'text', text: 'working' }, call],
        },
        {
          _id: 'c_seg1',
          segmentIndex: 1,
          parts: [{ type: 'text', text: 'still working' }],
        },
        {
          _id: 'c_seg2',
          segmentIndex: 2,
          parts: [{ type: 'text', text: 'done' }],
        },
      ],
    }

    const history = await _getProviderHistory(historyCtx(fixture), {
      streamId: 'stream_1' as never,
    })

    // Sealed segments enter the history through the processing doc; the
    // tool pair sealed into segment 0 stays visible to the next step.
    expect(history.map((m) => m._id)).toEqual([
      'm_user' as never,
      'm_current' as never,
    ])
    expect(history.at(-1)?.parts).toEqual([
      { type: 'text', text: 'working' },
      call,
      { type: 'text', text: 'still working' },
      { type: 'text', text: 'done' },
    ])
  })

  test('an empty in-flight turn stays out of the history', async () => {
    const fixture = baseFixture('invoke')
    fixture.segmentsByMessage.m_current = {
      2: [{ _id: 'c_current_2', segmentIndex: 0, parts: [] }],
    }

    const history = await _getProviderHistory(historyCtx(fixture), {
      streamId: 'stream_1' as never,
    })

    expect(history.map((m) => m._id)).toEqual(['m_user' as never])
  })
})

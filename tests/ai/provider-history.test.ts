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
    const predicates: Array<(row: Record<string, unknown>) => boolean> = []
    const matches = (row: Record<string, unknown>) =>
      predicates.every((predicate) => predicate(row))
    const obj = {
      filter: (fn?: (q: unknown) => unknown) => {
        if (fn) {
          predicates.push((row) =>
            Boolean(
              fn({
                field: (name: string) => row[name],
                eq: (a: unknown, b: unknown) => a === b,
              }),
            ),
          )
        }
        return obj
      },
      order: () => obj,
      first: async () =>
        table === 'messages' && index === 'by_sessionId_type_status'
          ? (summary && matches(summary) ? summary : null)
          : null,
      collect: async () => {
        if (
          table === 'messages' &&
          index === 'by_sessionId_status_contextEligible'
        ) {
          const creationTime = (message: Record<string, unknown>) =>
            message._creationTime as number
          return doneMessages.filter(
            (message) =>
              creationTime(message) >=
                ((captured.gte as number | undefined) ?? -Infinity) &&
              creationTime(message) <=
                ((captured.lte as number | undefined) ?? Infinity) &&
              matches(message),
          )
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
            gte: (_field: string, value: unknown) => {
              captured.gte = value
              return q
            },
            lte: (_field: string, value: unknown) => {
              captured.lte = value
              return q
            },
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

  test('a completed summary bounds the history at its creation time', async () => {
    const fixture = baseFixture('invoke')
    fixture.summary = {
      _id: 'm_summary',
      _creationTime: 150,
      role: 'assistant',
      type: 'summary',
      status: 'done',
      selectedVersion: 1,
      contextEligible: true,
    }

    const history = await _getProviderHistory(historyCtx(fixture), {
      streamId: 'stream_1' as never,
    })

    // Everything before the successful compaction stays out
    expect(history.map((m) => m._id)).toEqual(['m_current' as never])
  })

  test('an empty failed summary never becomes the context floor', async () => {
    const fixture = baseFixture('invoke')
    // What a failed/aborted compaction used to leave behind: a done summary
    // marker with no content and no eligibility
    fixture.summary = {
      _id: 'm_failed_summary',
      _creationTime: 150,
      role: 'assistant',
      type: 'summary',
      status: 'done',
      selectedVersion: 1,
      contextEligible: false,
    }

    const history = await _getProviderHistory(historyCtx(fixture), {
      streamId: 'stream_1' as never,
    })

    // The ineligible summary is skipped, so the earlier history survives
    expect(history.map((m) => m._id)).toEqual([
      'm_user' as never,
      'm_current' as never,
    ])
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

  test('includes a mid-turn interjection once the boundary moved past it', async () => {
    const finalized = {
      _id: 'm_assistant',
      _creationTime: 110,
      role: 'assistant',
      selectedVersion: 1,
    }
    const interrupt = {
      _id: 'm_interrupt',
      _creationTime: 120,
      role: 'user',
      selectedVersion: 1,
    }
    const fixture = baseFixture('invoke')
    // The rollover advanced the boundary onto the newest message (the interrupt)
    fixture.stream.contextBoundaryCreationTime = 120
    fixture.doneMessages = [
      userMessage,
      finalized,
      interrupt,
      // A later message beyond the boundary must stay out
      { ...interrupt, _id: 'm_late', _creationTime: 130 },
    ]
    fixture.segmentsByMessage.m_assistant = {
      1: [
        {
          _id: 'c_assistant_1',
          segmentIndex: 0,
          parts: [{ type: 'text', text: 'working' }],
        },
      ],
    }
    fixture.segmentsByMessage.m_interrupt = {
      1: [
        {
          _id: 'c_interrupt_1',
          segmentIndex: 0,
          parts: [{ type: 'text', text: 'stop, do X instead' }],
        },
      ],
    }
    // The post-rollover continuation message is still empty
    fixture.current = { ...retryMessage, _creationTime: 200 }
    fixture.segmentsByMessage.m_current = {
      2: [{ _id: 'c_current_2', segmentIndex: 0, parts: [] }],
    }

    const history = await _getProviderHistory(historyCtx(fixture), {
      streamId: 'stream_1' as never,
    })

    expect(history.map((m) => m._id)).toEqual([
      'm_user' as never,
      'm_assistant' as never,
      'm_interrupt' as never,
    ])
  })
})

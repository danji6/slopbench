/// <reference types="bun-types" />
import { reserveRetryStream } from '@sb/convex/model/chat/reserve'
import {
  getProviderRateLimitRetryDelay,
  getRateLimitRetryDelay,
  hasReplayableToolOutputSince,
} from '@sb/convex/model/stream/retry'
import { trackGeneratedOutput } from '@sb/convex/model/stream/transformers'
import { describe, expect, test } from 'bun:test'

async function drainStream<T>(stream: ReadableStream<T>): Promise<void> {
  const reader = stream.getReader()

  while (!(await reader.read()).done) {
    // Drain the stream so transforms run.
  }
}

describe('getRateLimitRetryDelay', () => {
  test('detects a structured 429 and honors retry-after-ms', () => {
    const error = {
      statusCode: 429,
      responseHeaders: { 'retry-after-ms': '2500' },
    }

    expect(getRateLimitRetryDelay(error, 1)).toBe(2500)
  })

  test('finds a rate limit in wrapped retry errors', () => {
    const error = {
      errors: [{ statusCode: 429, responseHeaders: { 'retry-after': '3' } }],
    }

    expect(getRateLimitRetryDelay(error, 2)).toBe(3000)
  })

  test('detects upstream rate limits hidden in response bodies', () => {
    const error = Object.assign(new Error('Provider request failed'), {
      statusCode: 400,
      responseBody: JSON.stringify({
        error: {
          message:
            'Model is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits.',
        },
      }),
    })

    expect(getRateLimitRetryDelay(error, 1)).toBe(1000)
  })

  test('detects upstream rate limits hidden in provider data', () => {
    const error = Object.assign(new Error('Provider request failed'), {
      data: {
        error: {
          message:
            'Model is temporarily rate-limited upstream. Please retry shortly.',
        },
      },
      headers: new Headers({ 'retry-after': '4' }),
    })

    expect(getRateLimitRetryDelay(error, 1)).toBe(4000)
  })

  test('applies exponential backoff when the provider gives no delay', () => {
    expect(getRateLimitRetryDelay(new Error('429 rate limit'), 3)).toBe(1562.5)
  })

  test('does not retry unrelated errors', () => {
    expect(getRateLimitRetryDelay(new Error('Bad request'), 1)).toBeNull()
  })
})

describe('getProviderRateLimitRetryDelay', () => {
  test('retries a 429 when the failing provider step has no output', () => {
    expect(
      getProviderRateLimitRetryDelay({
        error: new Error('429 rate limit'),
        retryAttempt: 1,
        hasOutput: false,
      }),
    ).toBe(1000)
  })

  test('retries rate limits even when the failing provider step has output', () => {
    expect(
      getProviderRateLimitRetryDelay({
        error: new Error('429 rate limit'),
        retryAttempt: 1,
        hasOutput: true,
      }),
    ).toBe(1000)
  })

  test('retries OpenRouter upstream rate limits after tool-loop output', () => {
    expect(
      getProviderRateLimitRetryDelay({
        error: new Error(
          'is temporarily rate-limited upstream. Please retry shortly',
        ),
        retryAttempt: 1,
        hasOutput: true,
      }),
    ).toBe(1000)
  })
})

describe('trackGeneratedOutput', () => {
  test('ignores non-output stream chunks', async () => {
    const tracker = { hasOutput: false }
    const input = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] })
        controller.close()
      },
    })

    await drainStream(
      input.pipeThrough(trackGeneratedOutput(tracker)({ tools: {} }) as never),
    )

    expect(tracker.hasOutput).toBe(false)
  })

  test('marks provider chunks from the current step as output', async () => {
    const tracker = { hasOutput: false }
    const input = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'text-delta', id: 'text', text: 'hello' })
        controller.close()
      },
    })

    await drainStream(
      input.pipeThrough(trackGeneratedOutput(tracker)({ tools: {} }) as never),
    )

    expect(tracker.hasOutput).toBe(true)
  })
})

describe('hasReplayableToolOutputSince', () => {
  test('accepts a completed tool output after the current step start', () => {
    const initialParts = [
      { type: 'step-start' },
      { type: 'text', state: 'done', text: 'checking workspace' },
      {
        type: 'tool-shell',
        state: 'output-available',
        toolCallId: 'functions.shell:4',
        input: { command: 'pwd && ls -la' },
        output: '...',
      },
    ]
    const latestParts = [
      ...initialParts,
      { type: 'step-start' },
      { type: 'text', state: 'done', text: 'checking more files' },
      {
        type: 'tool-shell',
        state: 'output-available',
        toolCallId: 'functions.shell:5',
        input: { command: 'find .' },
        output: '...',
      },
    ]

    expect(hasReplayableToolOutputSince(latestParts, initialParts.length)).toBe(
      true,
    )
  })

  test('accepts a completed tool output followed by the next step marker', () => {
    const initialParts = [{ type: 'step-start' }]
    const latestParts = [
      ...initialParts,
      { type: 'step-start' },
      { type: 'text', state: 'done', text: 'checking workspace' },
      {
        type: 'tool-shell',
        state: 'output-available',
        toolCallId: 'functions.shell:4',
        input: { command: 'pwd && ls -la' },
        output: '...',
      },
      { type: 'step-start' },
    ]

    expect(hasReplayableToolOutputSince(latestParts, initialParts.length)).toBe(
      true,
    )
  })

  test('rejects final assistant text after the current step start', () => {
    const initialParts = [{ type: 'step-start' }]
    const latestParts = [
      ...initialParts,
      { type: 'step-start' },
      { type: 'text', state: 'done', text: 'final answer' },
    ]

    expect(hasReplayableToolOutputSince(latestParts, initialParts.length)).toBe(
      false,
    )
  })

  test('rejects final assistant text after completed tool output', () => {
    const initialParts = [{ type: 'step-start' }]
    const latestParts = [
      ...initialParts,
      { type: 'step-start' },
      {
        type: 'tool-shell',
        state: 'output-available',
        toolCallId: 'functions.shell:4',
        input: { command: 'pwd && ls -la' },
        output: '...',
      },
      { type: 'text', state: 'done', text: 'done' },
    ]

    expect(hasReplayableToolOutputSince(latestParts, initialParts.length)).toBe(
      false,
    )
  })
})

describe('reserveRetryStream', () => {
  test('regenerates a multi-segment turn as a fresh (v+1, seg0) row', async () => {
    const session = { _id: 'session_1', settings: {}, metadata: {} }
    const agent = { _id: 'agent_1', name: 'Agent', ownerId: 'owner_1' }
    // A turn that was split into two segments by the byte cap
    const message = {
      _id: 'm_target',
      _creationTime: 100,
      sessionId: 'session_1',
      status: 'done',
      role: 'assistant',
      sender: { type: 'agent', id: 'agent_1' },
      selectedVersion: 1,
      versionCount: 1,
    }
    const docs = new Map<string, Record<string, unknown>>([
      [session._id, session],
      [agent._id, agent],
      [message._id, message],
    ])
    const patches: Array<{ id: string; patch: Record<string, unknown> }> = []
    const inserts: Array<{ table: string; fields: Record<string, unknown> }> =
      []
    const ctx = {
      userId: 'user_1',
      db: {
        get: async (id: string) => docs.get(id) ?? null,
        patch: async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, patch })
          const doc = docs.get(id)
          if (doc) Object.assign(doc, patch)
        },
        insert: async (table: string, fields: Record<string, unknown>) => {
          inserts.push({ table, fields })
          const id = `inserted_${inserts.length}`
          docs.set(id, { _id: id, ...fields })
          return id
        },
        query: (table: string) => ({
          withIndex: () => ({
            unique: async () =>
              table === 'sessionAgents'
                ? { _id: 'link_1' }
                : table === 'settings'
                  ? { _id: 'settings_1', ownerId: 'owner_1' }
                  : null,
            first: async () => null, // no active stream
            order: () => ({ first: async () => null }),
            collect: async () => [],
          }),
        }),
      },
      scheduler: {
        runAfter: async () => 'job_1',
      },
    } as never

    const streamId = await reserveRetryStream(ctx, {
      sessionId: 'session_1' as never,
      agentId: 'agent_1' as never,
      invokedBy: 'user_1' as never,
      messageId: 'm_target' as never,
    })

    expect(streamId).not.toBeNull()

    // A fresh version starts over as a single segment-0 row
    const contentRow = inserts.find(({ table }) => table === 'messageContents')
    expect(contentRow?.fields).toMatchObject({
      messageId: 'm_target',
      version: 2,
      segmentIndex: 0,
      parts: [],
    })
    expect(patches).toContainEqual({
      id: 'm_target',
      patch: expect.objectContaining({ selectedVersion: 2, versionCount: 2 }),
    })

    // The retry stream writes into the new segment row
    const stream = inserts.find(({ table }) => table === 'streams')
    expect(stream?.fields).toMatchObject({
      operation: 'retry',
      processingMessageId: 'm_target',
      processingContentId: 'inserted_1',
      suppressFollowUp: true,
    })
  })
})

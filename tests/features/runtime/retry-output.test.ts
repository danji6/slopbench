import {
  assertProviderStepOutput,
  hasReplayableToolOutputSince,
} from '@sb/convex/model/stream/retry'
import { trackGeneratedOutput } from '@sb/convex/model/stream/transformers'
import { describe, expect, test } from 'bun:test'
import { collectStream as drainStream } from '~/tests/helpers/streams'

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

  test('ignores empty text deltas', async () => {
    const tracker = { hasOutput: false }
    const input = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'text-delta', id: 'text', text: '  ' })
        controller.close()
      },
    })

    await drainStream(
      input.pipeThrough(trackGeneratedOutput(tracker)({ tools: {} }) as never),
    )

    expect(tracker.hasOutput).toBe(false)
  })

  test('counts a failed approved tool as output from the resumed step', async () => {
    const tracker = { hasOutput: false }
    const input = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: 'tool-error',
          toolCallId: 'approved-call',
          input: {},
          error: new Error('tool failed'),
        })
        controller.close()
      },
    })

    await drainStream(
      input.pipeThrough(trackGeneratedOutput(tracker)({ tools: {} }) as never),
    )

    expect(tracker.hasOutput).toBe(true)
  })
})

describe('assertProviderStepOutput', () => {
  test('accepts a step with generated output', () => {
    expect(() => assertProviderStepOutput(true, 'stop')).not.toThrow()
  })

  test('preserves the finish reason on an empty step error', () => {
    expect(() => assertProviderStepOutput(false, 'content-filter')).toThrow(
      'empty response (finish reason: content-filter)',
    )
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

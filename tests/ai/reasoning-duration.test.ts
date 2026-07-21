/// <reference types="bun-types" />
import {
  applyReasoningDurations,
  createReasoningTracker,
  trackReasoningTimings,
} from '@sb/convex/model/stream/reasoning'
import { afterEach, describe, expect, test } from 'bun:test'

type Chunk = { type: string; id?: string }

const REAL_NOW = Date.now

function mockNow(times: number[]) {
  let index = 0
  Date.now = () => times[Math.min(index++, times.length - 1)]!
}

async function drain(stream: ReadableStream<Chunk>) {
  const reader = stream.getReader()
  while (true) {
    const { done } = await reader.read()
    if (done) return
  }
}

function streamOf(chunks: Chunk[]) {
  return new ReadableStream<Chunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

describe('reasoning durations', () => {
  afterEach(() => {
    Date.now = REAL_NOW
  })

  test('times each reasoning block from its own start and end', async () => {
    const tracker = createReasoningTracker()
    mockNow([1000, 1500, 1800, 3000])

    await drain(
      streamOf([
        { type: 'reasoning-start', id: 'a' },
        { type: 'reasoning-end', id: 'a' },
        { type: 'reasoning-start', id: 'b' },
        { type: 'reasoning-end', id: 'b' },
      ]).pipeThrough(trackReasoningTimings(tracker)({ tools: {} }) as never),
    )

    const parts = applyReasoningDurations(
      [
        { type: 'reasoning', text: 'first', state: 'done' },
        { type: 'text', text: 'hello' },
        { type: 'reasoning', text: 'second', state: 'done' },
      ] as never,
      tracker,
      0,
    )

    expect(
      parts.map((part) => (part as { duration?: number }).duration),
    ).toEqual([500, undefined, 1200])
  })

  test('leaves parts from earlier steps untouched', async () => {
    const tracker = createReasoningTracker()
    mockNow([1000, 1400])

    await drain(
      streamOf([
        { type: 'reasoning-start', id: 'a' },
        { type: 'reasoning-end', id: 'a' },
      ]).pipeThrough(trackReasoningTimings(tracker)({ tools: {} }) as never),
    )

    const parts = applyReasoningDurations(
      [
        { type: 'reasoning', text: 'earlier', state: 'done', duration: 99 },
        { type: 'reasoning', text: 'current', state: 'done' },
      ] as never,
      tracker,
      1,
    )

    expect(
      parts.map((part) => (part as { duration?: number }).duration),
    ).toEqual([99, 400])
  })

  test('closes out a reasoning block the provider never ended', async () => {
    const tracker = createReasoningTracker()
    mockNow([1000, 2500])

    await drain(
      streamOf([{ type: 'reasoning-start', id: 'a' }]).pipeThrough(
        trackReasoningTimings(tracker)({ tools: {} }) as never,
      ),
    )

    const parts = applyReasoningDurations(
      [{ type: 'reasoning', text: 'cut off', state: 'streaming' }] as never,
      tracker,
      0,
    )

    expect((parts[0] as { duration?: number }).duration).toBe(1500)
  })
})

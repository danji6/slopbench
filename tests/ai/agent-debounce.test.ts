/// <reference types="bun-types" />
import {
  rescheduleStream,
  reserveOrDebounceTurn,
} from '@sb/convex/model/chat/reserve'
import { describe, expect, test } from 'bun:test'

type DebouncePatch = Record<string, unknown> & { state: { fireAt?: number } }

function rescheduleCtx(
  boundary: Record<string, unknown> | null,
  jobId?: string,
) {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = []
  const scheduled: Array<{ delay: number; args: Record<string, unknown> }> = []
  const cancelled: string[] = []
  let nextJob = 0

  const stream = {
    _id: 'stream_1',
    generation: 0,
    attempt: 0,
    state: jobId ? { phase: 'pending', jobId } : { phase: 'reserved' },
    command: { kind: 'invoke' },
  }
  const ctx = {
    db: {
      get: async (id: string) => (id === stream._id ? stream : boundary),
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch })
      },
    },
    scheduler: {
      cancel: async (jobId: string) => {
        cancelled.push(jobId)
      },
      runAfter: async (
        delay: number,
        _fn: unknown,
        args: Record<string, unknown>,
      ) => {
        scheduled.push({ delay, args })
        return `job_${++nextJob}`
      },
    },
  } as never

  return { ctx, patches, scheduled, cancelled }
}

describe('rescheduleStream (debounce reset)', () => {
  test('cancels the pending job and reschedules with a new fire time', async () => {
    const before = Date.now()
    const { ctx, patches, scheduled, cancelled } = rescheduleCtx(
      {
        _id: 'msg_2',
        _creationTime: 42,
      },
      'old_job',
    )

    await rescheduleStream(
      ctx,
      { _id: 'stream_1' as never },
      { boundaryId: 'msg_2' as never, delayMs: 5000 },
    )

    // Old scheduled claim is cancelled, a fresh one scheduled with the delay.
    expect(cancelled).toEqual(['old_job'])
    expect(scheduled).toEqual([
      { delay: 5000, args: { streamId: 'stream_1', generation: 1 } },
    ])

    // The stream is re-anchored to the new message with a pushed-out fireAt.
    const patch = Object.assign(
      {},
      ...patches.map(({ patch }) => patch),
    ) as DebouncePatch
    expect(patch).toMatchObject({
      state: { jobId: 'job_1' },
      contextBoundaryMessageId: 'msg_2',
      contextBoundaryCreationTime: 42,
    })
    expect(patch?.state.fireAt as number).toBeGreaterThanOrEqual(before + 5000)
  })

  test('tolerates a stream with no existing job', async () => {
    const { ctx, cancelled, scheduled } = rescheduleCtx(null)

    await rescheduleStream(
      ctx,
      { _id: 'stream_1' as never },
      { boundaryId: 'msg_2' as never, delayMs: 3000 },
    )

    expect(cancelled).toEqual([])
    expect(scheduled).toHaveLength(1)
  })
})

describe('reserveOrDebounceTurn (pending window)', () => {
  test('re-anchors a pending turn even without a debounce or fireAt', async () => {
    const { ctx, patches, scheduled, cancelled } = rescheduleCtx(
      {
        _id: 'msg_2',
        _creationTime: 42,
      },
      'job_old',
    )

    await reserveOrDebounceTurn(ctx, {
      session: { _id: 'session_1', activeAgentId: 'agent_1' },
      messageId: 'msg_2',
      invokedBy: 'user_1',
      silent: false,
      // A zero-debounce pending turn has no fireAt yet
      activeStream: {
        _id: 'stream_1',
        command: { kind: 'invoke' },
        state: { phase: 'pending', jobId: 'job_old' },
      },
    } as never)

    expect(cancelled).toEqual(['job_old'])
    expect(scheduled).toEqual([
      { delay: 0, args: { streamId: 'stream_1', generation: 1 } },
    ])
    const patch = Object.assign(
      {},
      ...patches.map(({ patch }) => patch),
    ) as DebouncePatch
    expect(patch).toMatchObject({
      contextBoundaryMessageId: 'msg_2',
      contextBoundaryCreationTime: 42,
    })
    expect(typeof patch?.state.fireAt).toBe('number')
  })

  test('leaves running and non-invoke streams alone', async () => {
    const { ctx, patches, scheduled, cancelled } = rescheduleCtx(null)

    for (const activeStream of [
      {
        _id: 'stream_1',
        command: { kind: 'invoke' },
        state: { phase: 'streaming' },
      },
      {
        _id: 'stream_1',
        command: { kind: 'compact' },
        state: { phase: 'pending' },
      },
      {
        _id: 'stream_1',
        command: { kind: 'invoke' },
        state: { phase: 'awaiting_approval' },
      },
    ]) {
      await reserveOrDebounceTurn(ctx, {
        session: { _id: 'session_1', activeAgentId: 'agent_1' },
        messageId: 'msg_2',
        invokedBy: 'user_1',
        silent: false,
        activeStream,
      } as never)
    }

    expect(cancelled).toEqual([])
    expect(scheduled).toEqual([])
    expect(patches).toEqual([])
  })
})

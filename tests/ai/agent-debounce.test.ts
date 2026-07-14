/// <reference types="bun-types" />
import { rescheduleStream } from '@sb/convex/model/chat/reserve'
import { describe, expect, test } from 'bun:test'

function rescheduleCtx(boundary: Record<string, unknown> | null) {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = []
  const scheduled: Array<{ delay: number; args: Record<string, unknown> }> = []
  const cancelled: string[] = []
  let nextJob = 0

  const ctx = {
    db: {
      get: async () => boundary,
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
    const { ctx, patches, scheduled, cancelled } = rescheduleCtx({
      _id: 'msg_2',
      _creationTime: 42,
    })

    await rescheduleStream(
      ctx,
      { _id: 'stream_1' as never, jobId: 'old_job' as never },
      { boundaryId: 'msg_2' as never, delayMs: 5000 },
    )

    // Old scheduled claim is cancelled, a fresh one scheduled with the delay.
    expect(cancelled).toEqual(['old_job'])
    expect(scheduled).toEqual([{ delay: 5000, args: { streamId: 'stream_1' } }])

    // The stream is re-anchored to the new message with a pushed-out fireAt.
    const patch = patches.find((p) => p.id === 'stream_1')?.patch
    expect(patch).toMatchObject({
      jobId: 'job_1',
      contextBoundaryMessageId: 'msg_2',
      contextBoundaryCreationTime: 42,
    })
    expect(patch?.fireAt as number).toBeGreaterThanOrEqual(before + 5000)
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

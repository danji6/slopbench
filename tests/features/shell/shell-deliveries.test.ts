import type { Id } from '@sb/convex/_generated/dataModel'
import type { MutationCtx } from '@sb/convex/_generated/server'
import {
  deleteVersions,
  replaceSelectedContent,
} from '@sb/convex/model/messageContents'
import { _report } from '@sb/convex/model/shellJobs'
import {
  executionPosition,
  positionFromRanges,
  readPosition,
  recordDelivery,
  removeDeliveriesForParts,
} from '@sb/convex/model/shellOutputDeliveries'
import { _patchMessage } from '@sb/convex/model/stream/lifecycleProgress'
import { makeOutputPreview } from '@sb/convex/model/stream/toolOutput'
import type { ShellOutputRange, ShellToolOutput } from '@sb/core/types/tools'
import { describe, expect, spyOn, test } from 'bun:test'
import { fakeCtx } from '~/tests/helpers/stream-lifecycle'

const reader = {
  sessionId: 'session_1' as Id<'sessions'>,
  agentId: 'agent_1' as Id<'agents'>,
  workspaceId: 'session_1',
}

const source = {
  ...reader,
  messageId: 'message_1' as Id<'messages'>,
  version: 1,
  partId: 'call_1',
}

const session = {
  _id: 'session_1',
  ownerId: 'user_1'
}

const message = {
  _id: 'message_1',
  _creationTime: 10,
  selectedVersion: 1,
  status: 'done',
  sessionId: 'session_1',
}

const stream = {
  _id: 'stream_1',
  ...reader,
  generation: 0,
  leaseExpiresAt: Infinity,
  command: { kind: 'invoke' },
  contextBoundaryCreationTime: 5,
  state: {
    phase: 'streaming',
    processingMessageId: 'message_1',
    processingContentId: 'content_1',
  },
}

function range(
  start = 0,
  end = 10,
  extra: Partial<ShellOutputRange> = {},
): ShellOutputRange {
  return {
    requestedOffset: start,
    startOffset: start,
    nextOffset: end,
    bufferEnd: end,
    hasMore: false,
    replay: false,
    unavailable: [],
    ansiState: 'text',
    ...extra,
  }
}

function output(page = range()): ShellToolOutput {
  return {
    jobId: 'job-1',
    status: 'done',
    exitCode: 0,
    text: 'a'.repeat(10),
    term: '',
    termOffset: 0,
    range: page,
  }
}

describe('shell output delivery provenance', () => {
  test('merges overlapping reads and exposes gaps left by discarded results', () => {
    expect(positionFromRanges([range(4, 10)]).offset).toBe(0)
    expect(
      positionFromRanges([range(4, 10), range(0, 6), range(5, 8)]).offset,
    ).toBe(10)
    expect(positionFromRanges([range(0, 10, { replay: true })]).offset).toBe(0)
  })

  test('keeps readers independent and follows selected versions without a compaction floor', async () => {
    const fixture = fakeCtx({
      docs: [
        { ...session },
        { ...message },
        { ...message, _id: 'later', _creationTime: 20 },
      ],
    })
    const ctx = fixture.ctx as MutationCtx
    await recordDelivery(ctx, source, output())
    await recordDelivery(ctx, source, output())
    expect(fixture.inserts).toHaveLength(1)
    expect((await readPosition(ctx, reader, 'job-1')).offset).toBe(10)
    expect(
      (
        await readPosition(
          ctx,
          { ...reader, agentId: 'other' as never },
          'job-1',
        )
      ).offset,
    ).toBe(0)
    expect(
      (
        await readPosition(
          ctx,
          { ...reader, sessionId: 'child' as never },
          'job-1',
        )
      ).offset,
    ).toBe(0)
    await ctx.db.patch(source.messageId, { selectedVersion: 2 })
    expect((await readPosition(ctx, reader, 'job-1')).offset).toBe(0)
    await ctx.db.patch(source.messageId, { selectedVersion: 1 })
    expect((await readPosition(ctx, reader, 'job-1')).offset).toBe(10)
    const otherSource = {
      ...source,
      messageId: 'later' as Id<'messages'>,
      partId: 'call_2',
    }
    // A later selected result cannot hide a hole in an earlier discarded version.
    await recordDelivery(ctx, otherSource, output(range(10, 20)))
    await ctx.db.patch(source.messageId, { selectedVersion: 2 })
    expect((await readPosition(ctx, reader, 'job-1')).offset).toBe(0)
  })

  test('invalidates coverage when individual results or their selected content are edited away', async () => {
    const fixture = fakeCtx({
      docs: [{ ...session }, { ...message }],
      contents: [
        {
          _id: 'content_1',
          messageId: 'message_1',
          version: 1,
          segmentIndex: 0,
          parts: [],
        },
      ],
    })
    const ctx = fixture.ctx as MutationCtx
    await recordDelivery(ctx, source, output(range(0, 4)))
    await recordDelivery(
      ctx,
      { ...source, partId: 'call_2' },
      output(range(4, 10)),
    )
    await removeDeliveriesForParts(ctx, {
      messageId: source.messageId,
      version: 1,
      parts: [
        {
          type: 'tool-shell_output',
          state: 'output-available',
          toolCallId: 'call_1',
          output: output(range(0, 4)),
        },
      ],
    })
    expect(await readPosition(ctx, reader, 'job-1')).toMatchObject({
      offset: 0,
      covered: [{ start: 4, end: 10 }],
    })
    await replaceSelectedContent(ctx, { ...message } as never, [
      { type: 'text', text: 'edited' },
    ])
    expect((await readPosition(ctx, reader, 'job-1')).covered).toEqual([])
  })

  test('excludes future reports and discarded retry versions while including the current message', async () => {
    const fixture = fakeCtx({
      docs: [
        { ...session },
        { ...message, status: 'processing' },
        { ...stream },
        { ...message, _id: 'before', _creationTime: 1 },
        { ...message, _id: 'report', _creationTime: 20 },
      ],
    })
    const ctx = fixture.ctx as MutationCtx
    await recordDelivery(
      ctx,
      { ...source, messageId: 'before' as never },
      output(range(0, 4)),
    )
    await recordDelivery(ctx, source, output(range(4, 6)))
    await recordDelivery(
      ctx,
      { ...source, messageId: 'report' as never },
      output(range(6, 10)),
    )
    const args = {
      streamId: 'stream_1' as Id<'streams'>,
      generation: 0,
      jobId: 'job-1',
    }
    expect((await executionPosition(ctx, args))?.offset).toBe(6)
    await ctx.db.patch(args.streamId, { contextBoundaryCreationTime: 20 })
    expect((await executionPosition(ctx, args))?.offset).toBe(10)
    await ctx.db.patch(source.messageId, { selectedVersion: 2 })
    expect((await executionPosition(ctx, args))?.offset).toBe(4)
    expect(await executionPosition(ctx, { ...args, generation: 1 })).toBeNull()
  })

  test('records only final saved results, preserving range metadata through offloading', async () => {
    const fixture = fakeCtx({
      docs: [{ ...session }, { ...message }, { ...stream }],
      contents: [
        {
          _id: 'content_1',
          messageId: 'message_1',
          version: 1,
          segmentIndex: 0,
          parts: [],
        },
      ],
    })
    const ctx = fixture.ctx as MutationCtx
    const part = {
      type: 'tool-shell_output',
      state: 'output-available',
      toolCallId: 'call_1',
      output: output(),
    }
    const args = {
      streamId: 'stream_1' as Id<'streams'>,
      generation: 0,
      parts: [part],
    }
    await _patchMessage(ctx, {
      ...args,
      parts: [{ ...part, preliminary: true }],
    })
    expect(fixture.inserts).toHaveLength(0)
    const patch = spyOn(ctx.db, 'patch').mockRejectedValueOnce(
      new Error('write failed'),
    )
    try {
      await expect(_patchMessage(ctx, args)).rejects.toThrow('write failed')
    } finally {
      patch.mockRestore()
    }
    expect(fixture.inserts).toHaveLength(0)
    const preview = makeOutputPreview({
      ...part.output,
      text: 'x'.repeat(24_000),
      term: 'x'.repeat(48_000),
    })
    await _patchMessage(ctx, {
      ...args,
      parts: [{ ...part, output: preview, outputRef: 'blob' }],
    })
    await _patchMessage(ctx, args)
    expect(
      fixture.inserts.filter((row) => row.table === 'shellOutputDeliveries'),
    ).toHaveLength(1)
    expect(
      (
        await readPosition(ctx, reader, 'job-1', {
          processingMessageId: source.messageId,
        })
      ).offset,
    ).toBe(10)
    await deleteVersions(ctx, source.messageId)
    expect((await readPosition(ctx, reader, 'job-1')).offset).toBe(0)
  })

  test('records report output atomically and ignores a stale watcher generation', async () => {
    const watch = {
      _id: 'watch_1',
      ...reader,
      jobId: 'job-1',
      toolCallId: 'call_1',
      command: 'build',
      generation: 0,
      startedAt: 0,
      heartbeatAt: 0,
      term: '',
      termOffset: 0,
      invokedBy: 'user_1',
    }
    const fixture = fakeCtx({ docs: [session, watch] })
    const ctx = fixture.ctx as MutationCtx
    const args = {
      shellJobId: 'watch_1' as Id<'shellJobs'>,
      generation: 1,
      output: output(),
    }
    await _report(ctx, args)
    expect(fixture.inserts).toHaveLength(0)
    await _report(ctx, { ...args, generation: 0 })
    expect(fixture.inserts.map((row) => row.table)).toEqual([
      'messages',
      'messageContents',
      'shellOutputDeliveries',
    ])
    expect((await readPosition(ctx, reader, 'job-1')).offset).toBe(10)
    await _report(ctx, { ...args, generation: 0 })
    expect(fixture.inserts).toHaveLength(3)

    const failed = fakeCtx({ docs: [{ ...session }, { ...watch }] })
    await _report(failed.ctx as MutationCtx, {
      ...args,
      generation: 0,
      errorText: 'failed delivery',
    })
    expect(failed.inserts.map((row) => row.table)).toEqual([
      'messages',
      'messageContents',
    ])
  })
})

import type { Doc } from '@sb/convex/_generated/dataModel'
import { reserveOrDebounceTurn } from '@sb/convex/model/chat/reserve'
import { getActiveStream } from '@sb/convex/model/session/memberships'
import {
  ownsExecution,
  scheduleStream,
} from '@sb/convex/model/stream/execution'
import { _claim } from '@sb/convex/model/stream/lifecycleClaims'
import { _prune } from '@sb/convex/model/stream/lifecycleCleanup'
import { stopExecution } from '@sb/convex/model/stream/stop'
import { activeStreamView } from '@sb/convex/model/stream/view'
import {
  streamCommandValidator,
  streamStateValidator,
} from '@sb/convex/validators/streams'
import { expect, test } from 'bun:test'
import { validate } from 'convex-helpers/validators'

import { lifecycleDatabase } from '../helpers/lifecycle-db'

const execution = { streamId: 'stream' as never, generation: 1 }
const stream = {
  _id: 'stream',
  generation: 1,
  sessionId: 'session',
  agentId: 'agent',
  invokedBy: 'user',
  command: { kind: 'invoke' },
  state: {
    phase: 'streaming',
    processingMessageId: 'message',
    processingContentId: 'content',
  },
  attempt: 0,
  leaseExpiresAt: 0,
}

function fixture(phase: 'streaming' | 'stopping' = 'streaming') {
  return lifecycleDatabase({
    streams: [
      { ...structuredClone(stream), state: { ...stream.state, phase } },
    ],
    sessions: [{ _id: 'session', ownerId: 'user', activeAgentId: 'agent' }],
    agents: [{ _id: 'agent', ownerId: 'user', name: 'Agent' }],
    sessionAgents: [{ _id: 'link', sessionId: 'session', agentId: 'agent' }],
    userSessions: [{ _id: 'member', sessionId: 'session', userId: 'user' }],
    messages: [
      {
        _id: 'message',
        sessionId: 'session',
        selectedVersion: 1,
        versionCount: 1,
        status: 'processing',
      },
    ],
    messageContents: [
      {
        _id: 'content',
        messageId: 'message',
        version: 1,
        segmentIndex: 0,
        parts: [],
      },
    ],
    offloadedOutputs: [
      {
        _id: 'output',
        streamId: 'stream',
        messageId: 'message',
        storageId: 'unused-blob',
      },
    ],
  })
}

test('command validators require retry restoration data and reject unrelated options', () => {
  for (const command of [
    { kind: 'invoke' },
    { kind: 'compact', autoCompact: true },
    { kind: 'impersonate', instructions: 'Continue' },
    { kind: 'retry', previousVersion: 1 },
  ]) {
    expect(validate(streamCommandValidator, command)).toBe(true)
  }
  for (const command of [
    { kind: 'retry' },
    { kind: 'invoke', autoCompact: true },
    { kind: 'compact', mode: 'plan' },
    { kind: 'impersonate', previousVersion: 1 },
  ]) {
    expect(validate(streamCommandValidator, command)).toBe(false)
  }
})

test('state validators reject incomplete states and fields from another phase', () => {
  for (const state of [
    { phase: 'pending', jobId: 'job' },
    { phase: 'streaming', processingMessageId: 'message' },
    {
      phase: 'retrying',
      jobId: 'job',
      processingMessageId: 'message',
      retryAt: 1,
      retryError: 'limit',
    },
    { phase: 'awaiting_input', processingMessageId: 'message' },
    { phase: 'stopping', retryError: 'limit' },
  ]) {
    expect(validate(streamStateValidator, state)).toBe(true)
  }
  for (const state of [
    { phase: 'pending' },
    { phase: 'streaming' },
    { phase: 'awaiting_approval' },
    { phase: 'awaiting_input', processingMessageId: 'message', jobId: 'job' },
    { phase: 'streaming', processingMessageId: 'message', retryAt: 1 },
    {
      phase: 'retrying',
      jobId: 'job',
      processingMessageId: 'message',
      retryAt: 1,
    },
    { phase: 'failed' },
  ]) {
    expect(validate(streamStateValidator, state)).toBe(false)
  }
})

test('retry and claim replace phase data while retaining logical command and output', async () => {
  const { ctx, rows, scheduled } = fixture()
  await scheduleStream(ctx, execution.streamId, {
    kind: 'retrying',
    retryAt: Date.now() + 1000,
    retryError: 'rate limit',
  })
  const retrying = rows('streams')[0] as unknown as Doc<'streams'>
  expect(retrying.attempt).toBe(1)
  expect(retrying.generation).toBe(2)
  expect(validate(streamStateValidator, retrying.state)).toBe(true)
  expect(ownsExecution(retrying, execution)).toBe(false)
  expect(scheduled[0]?.args.generation).toBe(2)
  const claimed = await _claim(ctx, { ...execution, generation: 2 })
  expect(claimed?.state).toMatchObject({
    phase: 'streaming',
    processingMessageId: 'message',
    processingContentId: 'content',
  })
  expect(claimed?.command).toEqual({ kind: 'invoke' })
})

test('stop cancels queued retry once, preserves its error, and cannot be rescheduled', async () => {
  const { ctx, rows, cancelled, scheduled } = fixture()
  await scheduleStream(ctx, execution.streamId, {
    kind: 'retrying',
    retryAt: 1000,
    retryError: 'rate limit',
  })
  await stopExecution(ctx, rows('streams')[0] as unknown as Doc<'streams'>)
  await stopExecution(ctx, rows('streams')[0] as unknown as Doc<'streams'>)
  expect(cancelled).toEqual(['job_1'])
  expect(scheduled).toHaveLength(2)
  expect(rows('streams')[0]?.state).toMatchObject({
    phase: 'stopping',
    retryError: 'rate limit',
  })
  await expect(scheduleStream(ctx, execution.streamId)).rejects.toThrow(
    'Cannot schedule a stopping stream',
  )
})

test('chat projection exposes controls without command, lease, or scheduler data', () => {
  const row = {
    ...stream,
    state: {
      phase: 'retrying',
      processingMessageId: 'message',
      jobId: 'job',
      retryAt: 1,
      retryError: 'limit',
    },
  } as unknown as Doc<'streams'>
  expect(activeStreamView(row)).toMatchObject({
    _id: 'stream',
    invokedBy: 'user',
    status: 'retrying',
    attempt: 0,
    processingMessageId: 'message',
    fireAt: undefined,
    retryAt: 1,
    retryError: 'limit',
  })
  expect(activeStreamView({ ...row, state: { phase: 'reserved' } })).toBeNull()
})

for (const phase of ['streaming', 'stopping'] as const) {
  test(`lookup and pruner finalize an expired ${phase} stream equivalently and once`, async () => {
    const lookup = fixture(phase)
    const pruner = fixture(phase)
    expect(await getActiveStream(lookup.ctx, 'session' as never)).toBeNull()
    await _prune(pruner.ctx)
    for (const state of [lookup, pruner]) {
      expect(state.rows('streams')).toHaveLength(0)
      expect(state.rows('messages')[0]?.status).toBe('done')
      expect(state.rows('offloadedOutputs')).toHaveLength(0)
      expect(state.deletedStorage).toEqual(['unused-blob'])
    }
    expect(lookup.rows('messages')[0]?.metadata).toEqual(
      pruner.rows('messages')[0]?.metadata,
    )
    expect(lookup.rows('notifications')).toEqual(pruner.rows('notifications'))
    const notifications = structuredClone(lookup.rows('notifications'))
    await _prune(lookup.ctx)
    expect(await getActiveStream(lookup.ctx, 'session' as never)).toBeNull()
    expect(lookup.rows('notifications')).toEqual(notifications)
  })
}

test('expiry returns auto-compaction reserved during finalization and blocks a duplicate invoke', async () => {
  const state = fixture()
  state.rows('scheduledEvents').push({
    _id: 'event',
    sessionId: 'session',
    invokedBy: 'user',
    dedupeKey: 'autoCompact',
    targetStreamId: 'stream',
    trigger: { type: 'stream_end' },
    action: { type: 'compact_session' },
    messageId: 'chip',
  })
  state.rows('messages').push({
    _id: 'chip',
    sessionId: 'session',
    status: 'done',
    extra: { name: 'autoCompact', status: 'queued' },
  })
  const replacement = await getActiveStream(state.ctx, 'session' as never)
  expect(replacement?.command.kind).toBe('compact')
  expect(replacement?.state.phase).toBe('pending')
  expect(state.rows('scheduledEvents')).toHaveLength(0)
  await reserveOrDebounceTurn(state.ctx, {
    session: state.rows('sessions')[0] as never,
    activeStream: replacement,
    messageId: 'message' as never,
    invokedBy: 'user' as never,
    silent: false,
  })
  expect(state.rows('streams')).toHaveLength(1)
  expect(
    state.rows('messages').find((row) => row._id === 'chip')?.extra,
  ).toMatchObject({ status: 'ran' })
})

test('parent shutdown suppresses an already-stopping child report without scheduling another finalizer', async () => {
  const { ctx, rows, scheduled } = fixture('stopping')
  await stopExecution(ctx, rows('streams')[0] as unknown as Doc<'streams'>, {
    suppressReport: true,
  })
  expect(rows('streams')[0]?.suppressReport).toBe(true)
  expect(scheduled).toHaveLength(0)
})

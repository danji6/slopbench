import { _createGenerated } from '@sb/convex/model/attachments'
import {
  _beginWindow,
  _carry,
  _report,
  refresh,
} from '@sb/convex/model/shellJobs'
import {
  _claim,
  _handoff,
  _heartbeat,
} from '@sb/convex/model/stream/lifecycleClaims'
import { _trackOffloadedOutput } from '@sb/convex/model/stream/lifecycleCleanup'
import { _scheduleRetry } from '@sb/convex/model/stream/lifecycleControl'
import {
  _saveMeta,
  saveCache,
  saveEnvironment,
  saveLog,
} from '@sb/convex/model/stream/lifecycleMeta'
import {
  _continue,
  _patchMessage,
  _recordStep,
} from '@sb/convex/model/stream/lifecycleProgress'
import {
  _complete,
  _fail,
  _finalizeStopped,
} from '@sb/convex/model/stream/lifecycleTerminal'
import { _getStopState } from '@sb/convex/model/stream/reads'
import { expect, test } from 'bun:test'

import { lifecycleDatabase } from '../helpers/lifecycle-db'

const execution = { streamId: 'stream' as never, generation: 2 }
function fixture(status = 'streaming') {
  return lifecycleDatabase({
    streams: [
      {
        _id: 'stream',
        generation: 3,
        status,
        operation: 'invoke',
        attempt: 0,
        sessionId: 'session',
        processingMessageId: 'message',
        processingContentId: 'content',
      },
    ],
    messages: [{ _id: 'message', status: 'processing' }],
    messageContents: [
      { _id: 'content', parts: [{ type: 'text', text: 'new output' }] },
    ],
  })
}

test('duplicate and obsolete stream actions cannot claim queued work', async () => {
  const { ctx, rows } = fixture('pending')
  expect(await _claim(ctx, execution)).toBeNull()
  expect(await _claim(ctx, { ...execution, generation: 3 })).not.toBeNull()
  expect(await _claim(ctx, { ...execution, generation: 3 })).toBeNull()
  expect(rows('streams')[0]?.status).toBe('streaming')
})

test('replaced executions cannot publish output, account usage, or schedule work', async () => {
  const { ctx, rows, scheduled } = fixture()
  const before = structuredClone(rows('streams'))
  expect(await _patchMessage(ctx, { ...execution, parts: [] })).toBe(false)
  expect(await _continue(ctx, execution)).toBe(false)
  expect(await _recordStep(ctx, { ...execution, interruptible: true })).toBe(
    false,
  )
  await _heartbeat(ctx, execution)
  await _saveMeta(ctx, {
    ...execution,
    duration: 1,
    warnings: [],
    toolErrors: [],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  })
  await _scheduleRetry(ctx, {
    ...execution,
    retryAt: Date.now(),
    retryError: 'old error',
  })
  expect(await _handoff(ctx, execution)).toBe(false)
  await _complete(ctx, execution)
  await _fail(ctx, { ...execution, message: 'old error' })
  expect(rows('streams')).toEqual(before)
  expect(rows('messageContents')[0]?.parts).toEqual([
    { type: 'text', text: 'new output' },
  ])
  expect(rows('sessionState')).toHaveLength(0)
  expect(scheduled).toHaveLength(0)
  expect(await _getStopState(ctx, execution)).toBe('stopped')
})

test('immediate stop wins against late completion and failure', async () => {
  const { ctx, rows } = fixture('stopping')
  const current = { ...execution, generation: 3 }
  await _complete(ctx, current)
  await _fail(ctx, { ...current, message: 'late failure' })
  expect(rows('streams')).toHaveLength(1)
  expect(rows('messages')[0]?.status).toBe('processing')
  await _finalizeStopped(ctx, { streamId: 'missing' as never })
})

test('handoff advances ownership without changing the retry count', async () => {
  const { ctx, rows, scheduled } = fixture()
  expect(await _handoff(ctx, { ...execution, generation: 3 })).toBe(true)
  expect(rows('streams')[0]).toMatchObject({
    generation: 4,
    status: 'pending',
    attempt: 0,
  })
  expect(scheduled[0]?.args).toEqual({ streamId: 'stream', generation: 4 })
  expect(await _claim(ctx, { ...execution, generation: 3 })).toBeNull()
})

test('stale cache, environment, and storage callbacks cannot mutate the replacement', async () => {
  const { ctx, rows, deletedStorage } = fixture()
  expect(
    await saveCache(ctx, {
      ...execution,
      sessionId: 'session' as never,
      agentId: 'agent' as never,
      items: [],
    }),
  ).toBeNull()
  await saveEnvironment(ctx, { ...execution, environment: { stale: true } })
  expect(await saveLog(ctx, { ...execution, storageId: 'log' as never })).toBe(
    false,
  )
  expect(
    await _trackOffloadedOutput(ctx, {
      ...execution,
      messageId: 'message' as never,
      storageId: 'output' as never,
    }),
  ).toBe(false)
  expect(
    await _createGenerated(ctx, {
      ...execution,
      messageId: 'message' as never,
      sessionId: 'session' as never,
      uploaderId: 'user' as never,
      storageId: 'image' as never,
      filename: 'image.png',
      mediaType: 'image/png',
    }),
  ).toBeNull()
  expect(deletedStorage).toEqual(['log', 'output', 'image'])
  expect(rows('sessionState')).toHaveLength(0)
  expect(rows('attachments')).toHaveLength(0)
})

function shellFixture() {
  return lifecycleDatabase({
    shellJobs: [
      {
        _id: 'watch',
        generation: 1,
        watcherId: 'scheduled',
        heartbeatAt: 0,
        sessionId: 'session',
        jobId: 'shell',
        term: 'old',
        termOffset: 3,
      },
    ],
    sessions: [{ _id: 'session', ownerId: 'owner', folderId: 'folder' }],
    sessionFolders: [
      {
        _id: 'folder',
        ownerId: 'owner',
        sources: [{ id: 'root', path: '/work', label: 'Work' }],
        revision: 0,
      },
    ],
  })
}
const watcher = { shellJobId: 'watch' as never, generation: 1 }

test('a shell watcher window can be claimed only once', async () => {
  const { ctx } = shellFixture()
  expect(await _beginWindow(ctx, watcher)).not.toBeNull()
  expect(await _beginWindow(ctx, watcher)).toBeNull()
})

test('refresh rejects old claims, continuation, and reports', async () => {
  const { ctx, rows, scheduled } = shellFixture()
  await refresh(ctx)
  expect(rows('shellJobs')[0]?.generation).toBe(2)
  expect(await _beginWindow(ctx, watcher)).toBeNull()
  await _carry(ctx, { ...watcher, term: 'stale', termOffset: 5 })
  await _report(ctx, { ...watcher, errorText: 'stale' })
  expect(rows('shellJobs')[0]?.term).toBe('old')
  expect(rows('messages')).toHaveLength(0)
  expect(scheduled).toHaveLength(1)
})

test('continuation transfers ownership and late reports cannot remove the new watch', async () => {
  const { ctx, rows, scheduled } = shellFixture()
  await _beginWindow(ctx, watcher)
  await _carry(ctx, { ...watcher, term: 'new output', termOffset: 10 })
  await _report(ctx, { ...watcher, errorText: 'old watcher error' })
  expect(rows('shellJobs')[0]).toMatchObject({
    generation: 2,
    term: 'new output',
    termOffset: 10,
  })
  expect(scheduled).toHaveLength(1)
  await _beginWindow(ctx, { ...watcher, generation: 2 })
  // Removing the session avoids delivery and isolates exactly-once settlement.
  rows('sessions').length = 0
  await _report(ctx, { ...watcher, generation: 2, errorText: 'current error' })
  await _report(ctx, {
    ...watcher,
    generation: 2,
    errorText: 'duplicate error',
  })
  expect(rows('shellJobs')).toHaveLength(0)
})

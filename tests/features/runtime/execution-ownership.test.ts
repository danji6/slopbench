import { _createGenerated } from '@sb/convex/model/attachments'
import {
  _beginWindow,
  _carry,
  _report,
  refresh,
} from '@sb/convex/model/shellJobs'
import { _claim, _handoff } from '@sb/convex/model/stream/lifecycleClaims'
import { _trackOffloadedOutput } from '@sb/convex/model/stream/lifecycleCleanup'
import {
  saveCache,
  saveEnvironment,
  saveLog,
} from '@sb/convex/model/stream/lifecycleMeta'
import { expect, test } from 'bun:test'
import {
  execution,
  fixture,
  shellFixture,
  watcher,
} from '~/tests/helpers/execution-ownership'

test('handoff advances ownership without changing the retry count', async () => {
  const { ctx, rows, scheduled } = fixture()
  expect(await _handoff(ctx, { ...execution, generation: 3 })).toBe(true)
  expect(rows('streams')[0]).toMatchObject({
    generation: 4,
    attempt: 0,
    state: { phase: 'pending' },
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

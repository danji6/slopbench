import { sanitizeMessages } from '@/lib/chat/messages'
import {
  isToolAutoApproved,
  mergeToolApprovals,
} from '@sb/convex/lib/tool/approval'
import {
  _claim,
  _handoff,
  _heartbeat,
} from '@sb/convex/model/stream/lifecycleClaims'
import { _scheduleRetry } from '@sb/convex/model/stream/lifecycleControl'
import { _saveMeta } from '@sb/convex/model/stream/lifecycleMeta'
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
import { type UIMessage } from 'ai'
import { expect, test } from 'bun:test'
import { execution, fixture } from '~/tests/helpers/execution-ownership'

test('duplicate and obsolete stream actions cannot claim queued work', async () => {
  const { ctx, rows } = fixture('pending')
  expect(await _claim(ctx, execution)).toBeNull()
  expect(await _claim(ctx, { ...execution, generation: 3 })).not.toBeNull()
  expect(await _claim(ctx, { ...execution, generation: 3 })).toBeNull()
  expect((rows('streams')[0]?.state as { phase: string })?.phase).toBe(
    'streaming',
  )
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

test('agent-approved tools skip the approval prompt', () => {
  const merged = mergeToolApprovals(undefined, { tools: ['write_file'] })
  expect(isToolAutoApproved('write_file', undefined, merged)).toBe(true)
  expect(isToolAutoApproved('read_file', undefined, merged)).toBe(false)
})

test('finalizes dangling tool input parts after abort', () => {
  const [message] = sanitizeMessages([
    {
      id: 'assistant',
      role: 'assistant',
      parts: [
        {
          type: 'tool-test',
          toolCallId: 'call-1',
          state: 'input-streaming',
          input: {},
        },
      ],
    } as unknown as UIMessage,
  ])

  expect(message?.parts[0]).toMatchObject({ state: 'output-error' })
})

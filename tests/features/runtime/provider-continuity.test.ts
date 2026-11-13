import { accumulateSessionUsage } from '@cv/convex/model/stream/lifecycleMeta'
import {
  clearProviderContinuity,
  prepareProviderRequest,
  recordCacheDiagnostic,
  saveProviderContinuity,
} from '@cv/convex/model/stream/providerRequests'
import { activeStreamView } from '@cv/convex/model/stream/view'
import type {
  CacheDiagnostic,
  ProviderContinuityScope,
  StreamExecutionArgs,
} from '@cv/convex/types'
import { describe, expect, test } from 'bun:test'

import { lifecycleDatabase } from '../../helpers/lifecycle-db'

const execution = { streamId: 'stream', generation: 1 } as StreamExecutionArgs
const scope = {
  providerId: 'openai',
  ownerId: 'owner',
  connectionId: 'connection',
  model: 'model',
  cacheKeyHash: 'key-hash',
  messageId: 'message',
} as ProviderContinuityScope
const value = { token: 'opaque-first-token', authRevision: 'sign-in-a' }

function fixture() {
  return lifecycleDatabase({
    streams: [
      {
        _id: 'stream',
        sessionId: 'session',
        generation: 1,
        attempt: 0,
        state: { phase: 'streaming', processingMessageId: 'message' },
      },
    ],
  })
}

function diagnostic(id: string): CacheDiagnostic {
  return {
    id,
    streamId: 'stream',
    messageId: 'message',
    generation: 1,
    attempt: 0,
    startedAt: 1,
    firstInTurn: true,
    resetReason: 'new-turn',
    requestHash: 'hash',
    cacheKeyHash: 'hash',
    instructionsHash: 'hash',
    toolsHash: 'hash',
    configurationHash: 'hash',
    inputHash: 'hash',
    inputItems: 1,
    continuityAvailable: false,
    requestedModel: 'model',
    outcome: 'pending',
  } as CacheDiagnostic
}

describe('provider continuity lifecycle', () => {
  test('retains the first token across execution handoffs, phase transitions and segment splits', async () => {
    const { ctx, rows } = fixture()
    const args = { ...execution, scope }
    expect((await prepareProviderRequest(ctx, args)).resetReason).toBe(
      'new-turn',
    )
    await saveProviderContinuity(ctx, { ...args, value, reset: false })
    await saveProviderContinuity(ctx, {
      ...args,
      value: { ...value, token: 'conflicting-token' },
      reset: false,
    })
    const stream = rows('streams')[0]
    for (const phase of [
      'retrying',
      'awaiting_approval',
      'awaiting_input',
      'pending',
    ]) {
      stream.state = { phase, processingMessageId: 'message' }
      stream.generation = Number(stream.generation) + 1
      stream.state = {
        phase: 'streaming',
        processingMessageId: 'message',
        processingContentId: 'new-segment',
      }
      expect(
        (
          await prepareProviderRequest(ctx, {
            ...args,
            generation: Number(stream.generation),
          })
        ).value,
      ).toEqual(value)
    }
    expect(
      await saveProviderContinuity(ctx, {
        ...args,
        value: { ...value, token: 'stale' },
        reset: true,
      }),
    ).toBe(false)
    expect(stream.providerContinuity).toMatchObject({ value })
  })

  test.each([
    ['messageId', 'new-message', 'new-turn'],
    ['ownerId', 'new-owner', 'connection-changed'],
    ['connectionId', 'new-connection', 'connection-changed'],
    ['model', 'new-model', 'model-changed'],
    ['cacheKeyHash', 'new-key', 'cache-key-changed'],
    ['providerId', 'other-provider', 'provider-changed'],
  ])('resets when %s changes', async (field, changed, reason) => {
    const { ctx, rows } = fixture()
    const args = { ...execution, scope }
    await prepareProviderRequest(ctx, args)
    await saveProviderContinuity(ctx, { ...args, value, reset: false })
    const next = { ...scope, [field]: changed }
    if (field === 'messageId')
      rows('streams')[0].state = {
        phase: 'streaming',
        processingMessageId: changed,
      }
    expect(
      await prepareProviderRequest(ctx, { ...args, scope: next }),
    ).toMatchObject({ value: undefined, resetReason: reason })
    expect(
      await saveProviderContinuity(ctx, { ...args, value, reset: false }),
    ).toBe(false)
  })

  test('clears state on provider exit and replaces state after a new sign-in', async () => {
    const { ctx, rows } = fixture()
    const args = { ...execution, scope }
    await prepareProviderRequest(ctx, args)
    await saveProviderContinuity(ctx, { ...args, value, reset: false })
    await saveProviderContinuity(ctx, {
      ...args,
      value: undefined,
      reset: true,
    })
    expect((await prepareProviderRequest(ctx, args)).value).toBeUndefined()
    const renewed = { token: 'new-token', authRevision: 'sign-in-b' }
    await saveProviderContinuity(ctx, { ...args, value: renewed, reset: false })
    expect((await prepareProviderRequest(ctx, args)).value).toEqual(renewed)
    await clearProviderContinuity(ctx, execution)
    expect(rows('streams')[0].providerContinuity).toBeUndefined()
  })

  test('does not expose opaque state in active-stream projections or inherit it into child streams', async () => {
    const { ctx, rows } = fixture()
    await prepareProviderRequest(ctx, { ...execution, scope })
    await saveProviderContinuity(ctx, {
      ...execution,
      scope,
      value,
      reset: false,
    })
    const projected = activeStreamView(rows('streams')[0] as never)
    expect(JSON.stringify(projected)).not.toContain(value.token)
    rows('streams').push({
      _id: 'child-stream',
      sessionId: 'child',
      generation: 1,
      state: { phase: 'streaming', processingMessageId: 'child-message' },
    })
    const child = await prepareProviderRequest(ctx, {
      streamId: 'child-stream' as never,
      generation: 1,
      scope: { ...scope, messageId: 'child-message' as never },
    })
    expect(child.value).toBeUndefined()
    expect(child.previous).toBeUndefined()
  })
})

test('keeps 50 diagnostic requests, updates idempotently and correlates saved zero/missing/nonzero usage', async () => {
  const { ctx, rows } = fixture()
  for (let index = 0; index < 52; index++) {
    await recordCacheDiagnostic(ctx, {
      ...execution,
      diagnostic: diagnostic(String(index)),
    })
  }
  const latest = {
    ...diagnostic('51'),
    outcome: 'completed' as const,
    completedAt: 2,
  }
  await recordCacheDiagnostic(ctx, { ...execution, diagnostic: latest })
  await recordCacheDiagnostic(ctx, { ...execution, diagnostic: latest })
  await recordCacheDiagnostic(ctx, {
    ...execution,
    diagnostic: { ...diagnostic('0'), outcome: 'completed' },
  })
  await recordCacheDiagnostic(ctx, {
    ...execution,
    generation: 0,
    diagnostic: diagnostic('stale'),
  })
  for (const cache of [
    { readTokens: 0, inputTokens: 100 },
    undefined,
    { readTokens: 80, inputTokens: 100 },
  ]) {
    await accumulateSessionUsage(
      ctx,
      'session' as never,
      { inputTokens: 100, outputTokens: 1, totalTokens: 101, cache },
      '51',
    )
    const history = rows('sessionState')[0]
      .cacheDiagnostics as CacheDiagnostic[]
    expect(history).toHaveLength(50)
    expect(history[0].id).toBe('2')
    expect(history.at(-1)).toMatchObject({
      inputTokens: 100,
      cacheReadTokens: cache?.readTokens,
    })
    expect(history.at(-1)?.usageSavedAt).toBeNumber()
  }
})

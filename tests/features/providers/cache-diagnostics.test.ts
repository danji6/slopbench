import type { ActionCtx } from '@sb/convex/_generated/server'
import { requestFingerprints } from '@sb/convex/actions/stream/cacheDiagnostics'
import { createCacheDiagnostics } from '@sb/convex/actions/stream/cacheDiagnostics'
import type { CacheDiagnostic } from '@sb/convex/types'
import { expect, test } from 'bun:test'
import { getFunctionName } from 'convex/server'

test('fingerprints complete inputs and distinguishes appended, changed and shortened prefixes', () => {
  const large = 'a'.repeat(100_000)
  const body = {
    input: [{ role: 'user', content: large }],
    tools: [{ name: 'tool' }],
    instructions: 'system',
    model: 'model',
    prompt_cache_key: 'session',
  }
  const first = requestFingerprints(body)
  const previous = first as CacheDiagnostic
  expect(
    requestFingerprints(
      {
        ...body,
        input: [...body.input, { role: 'assistant', content: 'next' }],
      },
      previous,
    ).prefixMatch,
  ).toBe('match')
  const changed = requestFingerprints(
    { ...body, input: [{ role: 'user', content: large.slice(0, -1) + 'b' }] },
    previous,
  )
  expect(changed.prefixMatch).toBe('changed')
  expect(changed.inputHash).not.toBe(first.inputHash)
  expect(changed.toolsHash).toBe(first.toolsHash)
  expect(
    requestFingerprints({ ...body, input: [] }, previous).prefixMatch,
  ).toBe('shortened')
  expect(JSON.stringify(first)).not.toContain('aaaa')
  expect(JSON.stringify(first)).not.toContain('session')
})

test('diagnostic write failures neither block inference nor replace transport errors', async () => {
  const ctx = {
    runMutation: async (reference: never) => {
      const name = getFunctionName(reference)
      if (name === 'streams:_recordCacheDiagnostic')
        throw new Error('fixture storage failure')
      if (name === 'streams:_prepareProviderRequest')
        return { resetReason: 'new-turn' }
      if (name === 'streams:_saveProviderContinuity') return true
      throw new Error('Unexpected mutation')
    },
  } as unknown as ActionCtx
  const diagnostics = createCacheDiagnostics(ctx, {
    execution: { streamId: 'stream' as never, generation: 1 },
    messageId: 'message' as never,
    attempt: 0,
    credentials: { providerId: 'openai', auth: 'chatgpt' },
  })
  const observer = await diagnostics.observeTransport({
    model: 'model',
    input: [],
    prompt_cache_key: 'session',
  })
  await observer.onResponse?.({
    status: 200,
    continuitySent: false,
    continuityReset: false,
    invalidContinuity: false,
  })
  await observer.onError?.()
  await diagnostics.complete({
    inputTokens: 100,
    outputTokens: 1,
    totalTokens: 101,
  })
  await diagnostics.fail(false)
  expect(diagnostics.requestId()).toBeString()
})

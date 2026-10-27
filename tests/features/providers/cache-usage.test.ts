import { inferenceAdapter } from '@sb/convex/model/provider/inferenceFactory'
import { getProviderOptions } from '@sb/convex/model/provider/options'
import { accumulateSessionUsage } from '@sb/convex/model/stream/lifecycleMeta'
import { resolveUsage } from '@sb/convex/model/stream/usage'
import { cacheHitRate } from '@sb/core/cache-usage'
import { requireCompletedStream } from '@sb/sidecar/providers/openai/stream'
import { generateText, streamText } from 'ai'
import { describe, expect, test } from 'bun:test'
import { lifecycleDatabase } from '~/tests/helpers/lifecycle-db'

function responseUsage(cachedTokens?: number | null) {
  return {
    input_tokens: 1000,
    output_tokens: 20,
    input_tokens_details:
      cachedTokens === undefined ? undefined : { cached_tokens: cachedTokens },
  }
}

function completedStream(cachedTokens?: number | null) {
  const event = {
    type: 'response.completed',
    response: { usage: responseUsage(cachedTokens) },
  }
  const body = new Response(`data: ${JSON.stringify(event)}\n\n`).body!
  return new Response(requireCompletedStream(body), {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

describe('provider cache reporting', () => {
  test.each([400, 0, undefined])(
    'preserves Mistral cache reads of %s, including measured misses',
    async (cachedTokens) => {
      const create = await inferenceAdapter('mistral')
      const model = await create({
        providerId: 'mistral',
        modelId: 'fixture-model',
        apiKey: 'fixture',
        requestFetch: (async (_input: RequestInfo | URL) =>
          Response.json({
            id: 'fixture',
            object: 'chat.completion',
            created: 0,
            model: 'fixture-model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Hello' },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 1000,
              completion_tokens: 20,
              total_tokens: 1020,
              num_cached_tokens: cachedTokens,
            },
          })) as typeof fetch,
      })
      const result = await generateText({
        model,
        prompt: 'Hello',
        maxRetries: 0,
      })
      const usage = await resolveUsage({
        usage: result.usage,
        outputText: result.text,
      })
      expect(usage.cache).toEqual(
        cachedTokens === undefined
          ? undefined
          : { readTokens: cachedTokens, inputTokens: 1000 },
      )
    },
  )

  test('uses Anthropic totals including cache reads and writes in the denominator', async () => {
    const create = await inferenceAdapter('anthropic')
    const model = await create({
      providerId: 'anthropic',
      modelId: 'fixture-model',
      apiKey: 'fixture',
      requestFetch: (async (_input: RequestInfo | URL) =>
        Response.json({
          id: 'fixture',
          type: 'message',
          role: 'assistant',
          model: 'fixture-model',
          content: [{ type: 'text', text: 'Hello' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 100,
            cache_creation_input_tokens: 300,
            cache_read_input_tokens: 600,
            output_tokens: 20,
          },
        })) as typeof fetch,
    })
    const result = await generateText({
      model,
      prompt: 'Hello',
      maxOutputTokens: 128,
      maxRetries: 0,
    })
    const usage = await resolveUsage({
      usage: result.usage,
      outputText: result.text,
    })
    expect(usage.inputTokens).toBe(1000)
    expect(usage.cache).toEqual({ readTokens: 600, inputTokens: 1000 })
    expect(cacheHitRate(usage.cache)).toBe(60)
  })

  test.each([512, 0, undefined, null])(
    'preserves subscription cache reads of %s through the real SDK stream',
    async (cachedTokens) => {
      const options = await getProviderOptions(
        'fixture-model',
        'auto',
        { providerId: 'openai', auth: 'chatgpt' },
        undefined,
        (async (_input: RequestInfo | URL) =>
          completedStream(cachedTokens)) as typeof fetch,
      )
      const result = streamText({
        model: options.languageModel,
        providerOptions: options.providerOptions,
        prompt: 'Hello',
        maxRetries: 0,
      })
      const usage = await resolveUsage({
        usage: await result.usage,
        outputText: '',
      })
      expect(usage.inputTokens).toBe(1000)
      expect(usage.cache).toEqual(
        cachedTokens == null
          ? undefined
          : { readTokens: cachedTokens, inputTokens: 1000 },
      )
    },
  )

  test.each([400, 0, undefined])(
    'preserves compatible Chat Completions cache reads of %s',
    async (cachedTokens) => {
      const create = await inferenceAdapter('custom')
      const model = await create({
        providerId: 'custom',
        modelId: 'fixture-model',
        baseURL: 'https://fixture.invalid/v1',
        apiKey: 'fixture',
        requestFetch: (async (_input: RequestInfo | URL) =>
          Response.json({
            id: 'fixture',
            created: 0,
            model: 'fixture-model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Hello' },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 1000,
              completion_tokens: 20,
              prompt_tokens_details:
                cachedTokens === undefined
                  ? undefined
                  : { cached_tokens: cachedTokens },
            },
          })) as typeof fetch,
      })
      const result = await generateText({
        model,
        prompt: 'Hello',
        maxRetries: 0,
      })
      const usage = await resolveUsage({
        usage: result.usage,
        outputText: result.text,
      })
      expect(usage.cache).toEqual(
        cachedTokens === undefined
          ? undefined
          : { readTokens: cachedTokens, inputTokens: 1000 },
      )
    },
  )

  test('uses the same contract for compatible Responses streams', async () => {
    const create = await inferenceAdapter('custom')
    const model = await create({
      providerId: 'custom',
      modelId: 'fixture-model',
      baseURL: 'https://fixture.invalid/v1/responses',
      apiKey: 'fixture',
      requestFetch: (async (_input: RequestInfo | URL) =>
        completedStream(250)) as typeof fetch,
    })
    const result = streamText({ model, prompt: 'Hello', maxRetries: 0 })
    const usage = await resolveUsage({
      usage: await result.usage,
      outputText: '',
    })
    expect(cacheHitRate(usage.cache)).toBe(25)
  })
})

test('accumulates weighted cache rates without diluting them with unmeasured requests', async () => {
  const { ctx, rows } = lifecycleDatabase({
    sessionState: [
      {
        _id: 'state',
        sessionId: 'session',
        usage: { inputTokens: 5000, outputTokens: 100, totalTokens: 5100 },
      },
    ],
  })
  for (const cache of [
    { readTokens: 800, inputTokens: 1000 },
    undefined,
    { readTokens: 0, inputTokens: 3000 },
  ]) {
    await accumulateSessionUsage(ctx, 'session' as never, {
      inputTokens: cache?.inputTokens ?? 2000,
      outputTokens: 20,
      totalTokens: (cache?.inputTokens ?? 2000) + 20,
      cache,
    })
  }
  expect(rows('sessionState')[0].usage).toEqual({
    inputTokens: 11000,
    outputTokens: 160,
    totalTokens: 11160,
    cache: { readTokens: 800, inputTokens: 4000 },
  })
})

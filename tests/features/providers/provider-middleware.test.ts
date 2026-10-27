import { createMoonshotAI } from '@ai-sdk/moonshotai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { withModelRoutes } from '@sb/convex/model/provider/modelMiddleware'
import { getProviderOptions } from '@sb/convex/model/provider/options'
import { withProviderMiddleware } from '@sb/convex/model/provider/providerMiddleware'
import {
  type UIMessage,
  readUIMessageStream,
  streamText,
  toUIMessageStream,
} from 'ai'
import { describe, expect, test } from 'bun:test'
import {
  captureQwenReasoningFetch,
  captureStreamFetch,
  captureStreamRequests,
  capturingModel,
  mixedVideoPdfPrompt,
  videoPrompt,
} from '~/tests/helpers/provider-middleware'

describe('provider model middleware', () => {
  test('serializes compatible video as video_url content', async () => {
    const bodies: Record<string, unknown>[] = []
    const model = createMoonshotAI({
      apiKey: 'test-key',
      baseURL: 'https://example.com/v1',
      fetch: captureStreamFetch(bodies),
    })('video-model') as unknown as LanguageModelV3

    await model.doStream({ prompt: videoPrompt() } as never)

    const messages = bodies[0].messages as Array<{
      content: Array<Record<string, unknown>>
    }>
    expect(messages[0].content).toEqual([
      {
        type: 'video_url',
        video_url: { url: 'data:video/mp4;base64,AQID' },
      },
    ])
  })

  test('routes video to the compatible model', async () => {
    const standard = capturingModel('standard')
    const video = capturingModel('video')
    const routed = await withProviderMiddleware({
      model: standard.model,
      videoModel: video.model,
    })

    await routed.doStream({ prompt: videoPrompt() } as never)

    expect(standard.calls).toBe(0)
    expect(video.calls).toBe(1)
    expect(await routed.supportedUrls).toHaveProperty('video/*')
  })

  test('does not reject video or mixed media based on provider guesses', async () => {
    const standard = capturingModel('standard')
    const passthrough = await withProviderMiddleware({
      model: standard.model,
    })

    await passthrough.doStream({ prompt: videoPrompt() } as never)
    expect(standard.calls).toBe(1)

    const video = capturingModel('video')
    const routed = await withProviderMiddleware({
      model: standard.model,
      videoModel: video.model,
    })
    await routed.doStream({ prompt: mixedVideoPdfPrompt() } as never)
    expect(video.calls).toBe(1)
  })

  test('optimistically forwards video through known chat transports', async () => {
    const cases = [
      ['openai', undefined, 'https://api.openai.com/v1/chat/completions'],
      [
        'openrouter',
        undefined,
        'https://openrouter.ai/api/v1/chat/completions',
      ],
      ['deepseek', undefined, 'https://api.deepseek.com/chat/completions'],
      ['mistral', undefined, 'https://api.mistral.ai/v1/chat/completions'],
      [
        'alibaba',
        undefined,
        'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      ],
      [
        'qwen',
        'https://qwen.example/v1',
        'https://qwen.example/v1/chat/completions',
      ],
      [
        'custom',
        'https://example.com/v1/responses',
        'https://example.com/v1/chat/completions',
      ],
    ] as const

    for (const [providerId, baseURL, expectedUrl] of cases) {
      const requests: Array<{ url: string; body: Record<string, unknown> }> = []
      const fetch = captureStreamRequests(requests)
      const options = await getProviderOptions(
        'video-model',
        'none',
        {
          providerId,
          apiKey: 'test-key',
          baseURL,
          model: { id: 'video-model' },
        },
        undefined,
        fetch,
      )

      await (options.languageModel as unknown as LanguageModelV3).doStream({
        prompt: videoPrompt(),
      } as never)

      expect(requests[0]?.url).toBe(expectedUrl)
      const messages = requests[0]?.body.messages as Array<{
        content: Array<Record<string, unknown>>
      }>
      expect(messages[0]?.content).toEqual([
        {
          type: 'video_url',
          video_url: { url: 'data:video/mp4;base64,AQID' },
        },
      ])
    }
  })

  test('requires Qwen endpoints to be configured explicitly', async () => {
    expect(
      getProviderOptions('qwen-model', 'none', {
        providerId: 'qwen',
        apiKey: 'test-key',
        model: { id: 'qwen-model' },
      }),
    ).rejects.toThrow('Provider URL not specified')
  })

  test('decodes Qwen reasoning_content into reasoning stream parts', async () => {
    const bodies: Record<string, unknown>[] = []
    const urls: string[] = []
    const fetch = captureQwenReasoningFetch(bodies, urls)
    const options = await getProviderOptions(
      'model-latest',
      'auto',
      {
        providerId: 'qwen',
        apiKey: 'test-key',
        baseURL: 'https://qwen.example/v1',
        model: {
          id: 'model-latest',
          reasoning: { type: 'binary', parameter: 'enable_thinking' },
        },
      },
      undefined,
      fetch,
    )

    const result = await (
      options.languageModel as unknown as LanguageModelV3
    ).doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Why?' }] }],
    } as never)
    const chunks = []
    for await (const chunk of result.stream) chunks.push(chunk)

    expect(urls[0]).toBe('https://qwen.example/v1/chat/completions')
    expect(bodies[0].enable_thinking).toBe(true)
    expect(bodies[0]).not.toHaveProperty('reasoning_effort')
    expect(chunks).toContainEqual({
      type: 'reasoning-start',
      id: 'reasoning-0',
    })
    expect(chunks).toContainEqual({
      type: 'reasoning-delta',
      id: 'reasoning-0',
      delta: 'because',
    })
    expect(chunks).toContainEqual({ type: 'reasoning-end', id: 'reasoning-0' })
    expect(chunks).toContainEqual({ type: 'text-delta', id: '0', delta: 'Answer' }) // prettier-ignore
  })

  test('preserves Qwen reasoning in the final UI message', async () => {
    const options = await getProviderOptions(
      'qwen3.8-max',
      'auto',
      {
        providerId: 'qwen',
        apiKey: 'test-key',
        baseURL: 'https://qwen.example/v1',
        model: {
          id: 'qwen3.8-max',
          reasoning: { type: 'binary', parameter: 'enable_thinking' },
        },
      },
      undefined,
      captureQwenReasoningFetch([], []),
    )
    const result = streamText({
      model: options.languageModel,
      prompt: 'Why?',
      reasoning: options.reasoning,
    })
    let message: UIMessage | undefined
    for await (const update of readUIMessageStream({
      message: { id: 'assistant', role: 'assistant', parts: [] },
      stream: toUIMessageStream({ stream: result.stream }),
    })) {
      message = update
    }

    expect(message?.parts).toContainEqual({
      type: 'reasoning',
      id: 'reasoning-0',
      text: 'because',
      state: 'done',
    })
  })

  test('generic routes can proxy unrelated model conditions', async () => {
    const standard = capturingModel('standard')
    const alternate = capturingModel('alternate')
    const routed = await withModelRoutes(standard.model, [
      {
        matches: ({ prompt }) => prompt.length > 0,
        model: alternate.model,
      },
    ])

    await routed.doStream({ prompt: videoPrompt() } as never)

    expect(standard.calls).toBe(0)
    expect(alternate.calls).toBe(1)
  })
})

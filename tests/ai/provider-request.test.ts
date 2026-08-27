/// <reference types="bun-types" />
import { createMoonshotAI } from '@ai-sdk/moonshotai'
import type { LanguageModelV3, LanguageModelV4Prompt } from '@ai-sdk/provider'
import { withModelRoutes } from '@sb/convex/model/provider/model-middleware'
import { getProviderOptions } from '@sb/convex/model/provider/options'
import { withProviderMiddleware } from '@sb/convex/model/provider/provider-middleware'
import { createProviderFetch } from '@sb/convex/model/provider/request'
import { parseModelExtraParameters } from '@sb/core/model-parameters'
import { normalizeReasoningEffort } from '@sb/core/model-reasoning'
import { parseProviderExtraHeaders } from '@sb/core/provider-headers'
import {
  type UIMessage,
  readUIMessageStream,
  streamText,
  toUIMessageStream,
} from 'ai'
import { describe, expect, test } from 'bun:test'

describe('model extra parameters', () => {
  test('requires a JSON object and rejects structural request fields', () => {
    expect(() => parseModelExtraParameters('[]')).toThrow('JSON object')
    expect(() => parseModelExtraParameters('{ nope')).toThrow('valid JSON')
    expect(() => parseModelExtraParameters('{"messages":[]}')).toThrow(
      'reserved fields: messages',
    )
  })

  test('accepts unknown provider fields', () => {
    expect(
      parseModelExtraParameters('{"thinking_budget":4096,"custom":true}'),
    ).toEqual({ thinking_budget: 4096, custom: true })
  })
})

describe('provider request body adapter', () => {
  test('injects binary thinking and lets extras override it', async () => {
    const bodies: Record<string, unknown>[] = []
    const logs: string[] = []
    const fetch = createProviderFetch({
      providerId: 'qwen',
      reasoning: { type: 'binary', parameter: 'enable_thinking' },
      reasoningEffort: 'auto',
      extraParameters: '{"enable_thinking":false,"service_tier":"fast"}',
      fetch: captureFetch(bodies),
      onRequest: (body) => {
        logs.push(body)
      },
    })

    await fetch('https://example.com/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'qwen', messages: [] }),
    })

    expect(bodies).toEqual([
      {
        model: 'qwen',
        messages: [],
        enable_thinking: false,
        service_tier: 'fast',
      },
    ])
    expect(JSON.parse(logs[0])).toEqual(bodies[0])
  })

  test('sends max through the provider wire mapping', async () => {
    const bodies: Record<string, unknown>[] = []
    const fetch = createProviderFetch({
      providerId: 'custom',
      reasoning: { type: 'effort', efforts: ['xhigh', 'max'] },
      reasoningEffort: 'max',
      fetch: captureFetch(bodies),
    })

    await fetch('https://example.com/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'model', messages: [] }),
    })

    expect(bodies[0].reasoning_effort).toBe('max')
  })

  test('maps Ollama reasoning according to each model configuration', async () => {
    const binaryBodies: Record<string, unknown>[] = []
    const binaryFetch = createProviderFetch({
      providerId: 'ollama',
      reasoning: { type: 'binary', parameter: 'think' },
      reasoningEffort: 'none',
      fetch: captureFetch(binaryBodies),
    })
    await binaryFetch('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ model: 'qwen3', messages: [] }),
    })

    const effortBodies: Record<string, unknown>[] = []
    const effortFetch = createProviderFetch({
      providerId: 'ollama',
      reasoning: { type: 'effort', efforts: ['low', 'high', 'max'] },
      reasoningEffort: 'max',
      fetch: captureFetch(effortBodies),
    })
    await effortFetch('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-oss', messages: [], think: true }),
    })

    expect(binaryBodies[0].think).toBe(false)
    expect(effortBodies[0].think).toBe('max')
  })

  test('uses nested reasoning for Responses API bodies', async () => {
    const bodies: Record<string, unknown>[] = []
    const fetch = createProviderFetch({
      providerId: 'custom',
      reasoning: { type: 'effort', efforts: ['max'] },
      reasoningEffort: 'max',
      fetch: captureFetch(bodies),
    })

    await fetch('https://example.com/responses', {
      method: 'POST',
      body: JSON.stringify({
        model: 'model',
        input: [],
        reasoning: { summary: 'detailed' },
      }),
    })

    expect(bodies[0].reasoning).toEqual({ summary: 'detailed', effort: 'max' })
  })

  test('merges provider headers without including them in body logs', async () => {
    const requests: RequestInit[] = []
    const logs: string[] = []
    const fetch = createProviderFetch({
      providerId: 'custom',
      extraHeaders: '{"X-Custom":"configured","HTTP-Referer":"app"}',
      fetch: captureRequest(requests),
      onRequest: (body) => {
        logs.push(body)
      },
    })

    await fetch('https://example.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Custom': 'generated' },
      body: JSON.stringify({ model: 'model', messages: [] }),
    })

    const headers = new Headers(requests[0].headers)
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('x-custom')).toBe('configured')
    expect(headers.get('http-referer')).toBe('app')
    expect(logs[0]).not.toContain('configured')
  })
})

describe('provider extra headers', () => {
  test('requires string values and rejects transport-managed headers', () => {
    expect(() => parseProviderExtraHeaders('{"X-Number":1}')).toThrow(
      'must be strings',
    )
    expect(() => parseProviderExtraHeaders('{"Content-Length":"12"}')).toThrow(
      'managed by the HTTP transport',
    )
    expect(() => parseProviderExtraHeaders('{"x-test":"ok\\r\\nbad"}')).toThrow(
      'Invalid header value',
    )
  })
})

describe('reasoning normalization', () => {
  test('normalizes unsupported efforts and binary values', () => {
    expect(
      normalizeReasoningEffort('xhigh', {
        type: 'effort',
        efforts: ['low', 'medium', 'high'],
      }),
    ).toBe('auto')
    expect(
      normalizeReasoningEffort('high', {
        type: 'binary',
        parameter: 'enable_thinking',
      }),
    ).toBe('auto')
    expect(
      normalizeReasoningEffort('auto', {
        type: 'none',
      }),
    ).toBe('none')
  })
})

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
        undefined,
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
      getProviderOptions('qwen-model', 'none', undefined, {
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
      undefined,
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
      undefined,
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

function captureFetch(bodies: Record<string, unknown>[]) {
  const fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return fetch as typeof globalThis.fetch
}

function captureStreamFetch(bodies: Record<string, unknown>[]) {
  const fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return new Response('data: [DONE]\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }
  return fetch as typeof globalThis.fetch
}

function captureStreamRequests(
  requests: Array<{ url: string; body: Record<string, unknown> }>,
) {
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    })
    return new Response('data: [DONE]\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }
  return fetch as typeof globalThis.fetch
}

function captureQwenReasoningFetch(
  bodies: Record<string, unknown>[],
  urls: string[],
) {
  const events = [
    {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'model-latest',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', reasoning_content: 'because' },
          finish_reason: null,
        },
      ],
    },
    {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'model-latest',
      choices: [
        { index: 0, delta: { content: 'Answer' }, finish_reason: null },
      ],
    },
    {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'model-latest',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    },
  ]
  const data = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`

  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(input))
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    // Some compatible gateways omit the standard SSE content type.
    return new Response(data, { status: 200 })
  }
  return fetch as typeof globalThis.fetch
}

function captureRequest(requests: RequestInit[]) {
  const fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init ?? {})
    return new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return fetch as typeof globalThis.fetch
}

function capturingModel(id: string) {
  const state = { calls: 0 }
  const emptyStream = () =>
    new ReadableStream({
      start(controller) {
        controller.close()
      },
    })
  const model = {
    specificationVersion: 'v3',
    provider: 'test',
    modelId: id,
    supportedUrls: {},
    doGenerate: async () => {
      state.calls += 1
      throw new Error('not used')
    },
    doStream: async () => {
      state.calls += 1
      return { stream: emptyStream(), request: {}, response: {} }
    },
  } as unknown as LanguageModelV3
  return {
    model,
    get calls() {
      return state.calls
    },
  }
}

function videoPrompt(): LanguageModelV4Prompt {
  return [
    {
      role: 'user',
      content: [
        {
          type: 'file',
          data: { type: 'data', data: new Uint8Array([1, 2, 3]) },
          mediaType: 'video/mp4',
        },
      ],
    },
  ]
}

function mixedVideoPdfPrompt(): LanguageModelV4Prompt {
  return [
    {
      role: 'user',
      content: [
        {
          type: 'file',
          data: { type: 'data', data: new Uint8Array([1, 2, 3]) },
          mediaType: 'video/mp4',
        },
        {
          type: 'file',
          data: { type: 'data', data: new Uint8Array([4, 5, 6]) },
          mediaType: 'application/pdf',
        },
      ],
    },
  ]
}

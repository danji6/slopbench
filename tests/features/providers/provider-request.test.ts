import { getProviderOptions } from '@sb/convex/model/provider/options'
import { createProviderFetch } from '@sb/convex/model/provider/request'
import { parseModelExtraParameters } from '@sb/core/model-parameters'
import { normalizeReasoningEffort } from '@sb/core/model-reasoning'
import { parseProviderExtraHeaders } from '@sb/core/provider-headers'
import { describe, expect, test } from 'bun:test'
import {
  captureFetch,
  captureRequest,
} from '~/tests/helpers/provider-middleware'

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

describe('model-owned inference', () => {
  test('provider options use the selected model configuration', async () => {
    const options = await getProviderOptions('gpt-test', 'none', {
      providerId: 'openai',
      apiKey: 'test-key',
      model: {
        id: 'gpt-test',
        inference: {
          temperature: 0.35,
          topP: 0.8,
          frequencyPenalty: 0.2,
          presencePenalty: 0.1,
        },
      },
    })

    expect(options).toMatchObject({
      temperature: 0.35,
      topP: 0.8,
      frequencyPenalty: 0.2,
      presencePenalty: 0.1,
    })
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

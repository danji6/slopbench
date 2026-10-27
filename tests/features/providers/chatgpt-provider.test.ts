import { getProviderOptions } from '@sb/convex/model/provider/options'
import { prepareChatGPTRequest } from '@sb/core/chatgpt-policy'
import { modelReference } from '@sb/core/model-reference'
import { requireCompletedStream } from '@sb/sidecar/providers/openai/stream'
import { streamText, tool } from 'ai'
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'

describe('ChatGPT subscription inference', () => {
  test('applies required transport policy after ordinary parameters', () => {
    expect(
      prepareChatGPTRequest({
        input: [{ role: 'system', content: 'rules' }],
        store: true,
        stream: false,
        temperature: 1,
        max_output_tokens: 20,
        previous_response_id: 'old',
      }),
    ).toEqual({
      input: [{ role: 'developer', content: 'rules' }],
      store: false,
      stream: true,
      temperature: 1,
      max_output_tokens: 20,
      previous_response_id: 'old',
    })
    expect(() =>
      prepareChatGPTRequest({ input: [{ type: 'item_reference', id: 'old' }] }),
    ).toThrow('stored response')
    expect(() =>
      prepareChatGPTRequest({
        input: [],
        tools: [{ type: 'code_interpreter' }],
      }),
    ).toThrow('namespaced')
  })
  test('serializes a real SDK request with raw model ID, developer messages, namespaced tools and encrypted reasoning', async () => {
    const bodies: Record<string, unknown>[] = []
    const capture = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response('data: [DONE]\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as typeof fetch
    const resolved = await getProviderOptions(
      modelReference('conn', 'fixture-model'),
      'auto',
      {
        providerId: 'openai',
        connectionId: 'conn',
        auth: 'chatgpt',
        model: { id: 'fixture-model', inference: { temperature: 0.5 } },
      },
      undefined,
      capture,
    )
    const result = streamText({
      model: resolved.languageModel,
      providerOptions: resolved.providerOptions,
      system: 'Follow these rules',
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'reasoning',
              text: 'old',
              providerOptions: { openai: { itemId: 'reference-only' } },
            },
            {
              type: 'reasoning',
              text: 'encrypted',
              providerOptions: {
                openai: { reasoningEncryptedContent: 'fixture-ciphertext' },
              },
            },
            { type: 'text', text: 'hello' },
          ],
        },
        { role: 'user', content: 'Run a tool' },
      ],
      tools: {
        inspect: tool({
          description: 'Inspect',
          inputSchema: z.object({ path: z.string() }),
        }),
      },
      maxOutputTokens: 512,
      maxRetries: 0,
    })
    for await (const _ of result.fullStream) {
      /* drain request */
    }
    expect(bodies).toHaveLength(1)
    const body = bodies[0]
    expect(body.model).toBe('fixture-model')
    expect(body.store).toBe(false)
    expect(body.stream).toBe(true)
    expect(body.max_output_tokens).toBe(512)
    expect(body.temperature).toBe(0.5)
    expect(body.tools).toEqual([
      expect.objectContaining({
        type: 'namespace',
        name: 'slopbench',
        tools: [expect.objectContaining({ type: 'function', name: 'inspect' })],
      }),
    ])
    expect(JSON.stringify(body.input)).toContain('developer')
    expect(JSON.stringify(body.input)).toContain('fixture-ciphertext')
    expect(JSON.stringify(body.input)).not.toContain('reference-only')
    expect(body.include).toContain('reasoning.encrypted_content')
  })
  test('blocks unavailable selections before any inference', async () => {
    await expect(
      getProviderOptions('model', 'auto', {
        providerId: 'openai',
        model: { id: 'model', available: false },
      }),
    ).rejects.toThrow('no longer listed')
  })
  test('requires a completed SSE event and propagates midstream failure', async () => {
    const stream = (events: unknown[]) =>
      requireCompletedStream(
        new Response(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
        ).body!,
      )
    await expect(
      new Response(
        stream([{ type: 'response.output_text.delta', delta: 'partial' }]),
      ).text(),
    ).rejects.toThrow('response.completed')
    await expect(
      new Response(
        stream([
          {
            type: 'response.failed',
            response: {
              error: { code: 'subscription_sharing_usage_limit_exceeded' },
            },
          },
        ]),
      ).text(),
    ).rejects.toThrow('usage limit')
    expect(
      await new Response(stream([{ type: 'response.completed' }])).text(),
    ).toContain('response.completed')
  })
})

test('replays client tool calls with their namespace and full output', async () => {
  let body: Record<string, unknown> = {}
  const capture = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body))
    return new Response('data: [DONE]\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as typeof fetch
  const resolved = await getProviderOptions(
    'model',
    'auto',
    { providerId: 'openai', auth: 'chatgpt', model: { id: 'model' } },
    undefined,
    capture,
  )
  const result = streamText({
    model: resolved.languageModel,
    providerOptions: resolved.providerOptions,
    maxRetries: 0,
    messages: [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'inspect',
            input: { path: 'a' },
            providerOptions: {
              openai: { namespace: 'slopbench', itemId: 'stored-function' },
            },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'inspect',
            output: { type: 'text', value: 'file contents' },
          },
        ],
      },
      { role: 'user', content: 'Continue' },
    ],
    tools: { inspect: tool({ inputSchema: z.object({ path: z.string() }) }) },
  })
  for await (const _ of result.fullStream) {
    /* drain request */
  }
  expect(body.input).toContainEqual(
    expect.objectContaining({
      type: 'function_call',
      namespace: 'slopbench',
      name: 'inspect',
    }),
  )
  expect(body.input).toContainEqual(
    expect.objectContaining({
      type: 'function_call_output',
      output: 'file contents',
    }),
  )
  expect(JSON.stringify(body.input)).not.toContain('item_reference')
})

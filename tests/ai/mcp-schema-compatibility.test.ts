import { createOpenAI } from '@ai-sdk/openai'
import { asSchema } from '@ai-sdk/provider-utils'
import {
  mcpBrokerCallSchema,
  mcpBrokerSearchSchema,
} from '@sb/core/types/mcp-catalog'
import { mcpProtocolBrokerSchema } from '@sb/core/types/mcp-protocol'
import { expect, test } from 'bun:test'

test.each(['responses', 'chat'] as const)(
  'MCP argument dictionaries produce no OpenAI %s compatibility warnings',
  async (transport) => {
    const provider = createOpenAI({
      apiKey: 'test-key',
      fetch: (async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response('data: [DONE]\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        })) as typeof globalThis.fetch,
    })
    const tools = await Promise.all(
      Object.entries({
        call_mcp_tool: mcpBrokerCallSchema,
        search_mcp_tools: mcpBrokerSearchSchema,
        mcp_protocol: mcpProtocolBrokerSchema,
      }).map(async ([name, schema]) => ({
        type: 'function' as const,
        name,
        inputSchema: await asSchema<unknown>(schema).jsonSchema,
      })),
    )
    const result = await provider[transport]('test-model').doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
      tools,
    })
    const reader = result.stream.getReader()
    try {
      const start = await reader.read()
      expect(start.value).toEqual({ type: 'stream-start', warnings: [] })
    } finally {
      await reader.cancel()
    }
  },
)

test('MCP calls preserve arbitrary JSON argument keys and nested values', () => {
  const input = {
    tool: 'tool',
    arguments: {
      'target-path': '/tmp/target',
      '': null,
      nested: { count: 2, enabled: true, items: ['a', null, { b: false }] },
    },
  }
  expect(mcpBrokerCallSchema.parse(input)).toEqual(input)
  expect(mcpBrokerCallSchema.parse({ ...input, arguments: {} })).toEqual({
    ...input,
    arguments: {},
  })
  for (const args of [null, [], 'text', 1]) {
    expect(
      mcpBrokerCallSchema.safeParse({ ...input, arguments: args }).success,
    ).toBe(false)
  }
})

test('MCP prompt arguments retain their string value limits', () => {
  const input = {
    server: 'server',
    method: 'get_prompt' as const,
    name: 'prompt',
    arguments: { 'target-path': '/tmp/target', '': 'value' },
  }
  expect(mcpProtocolBrokerSchema.parse(input)).toEqual(input)
  for (const value of [123, null, {}, 'x'.repeat(32_769)]) {
    expect(
      mcpProtocolBrokerSchema.safeParse({
        ...input,
        arguments: { target: value },
      }).success,
    ).toBe(false)
  }
})

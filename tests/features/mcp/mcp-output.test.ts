import type { Id } from '@sb/convex/_generated/dataModel'
import type { ActionCtx } from '@sb/convex/_generated/server'
import { resolveOffloadedOutput } from '@sb/convex/actions/stream/historyContent'
import { makeOutputPreview } from '@sb/convex/model/stream/toolOutput'
import {
  hasToolResultMedia,
  mcpHistoryTools,
  mcpToModelOutput,
} from '@sb/convex/model/tool/mcpOutput'
import { mcpResult, mcpResultPreview } from '@sb/core/types/mcp-result'
import { type UIMessage, convertToModelMessages } from 'ai'
import { expect, test } from 'bun:test'

function result() {
  return mcpResult(
    {
      content: [
        { type: 'text', text: '{"value":42}' },
        { type: 'text', text: 'Different output' },
        {
          type: 'text',
          text: 'For the user only',
          annotations: { audience: ['user'] },
        },
        { type: 'image', mimeType: 'image/png', data: 'AAEC' },
        { type: 'audio', mimeType: 'audio/wav', data: 'AAAA' },
        {
          type: 'resource',
          resource: { uri: 'fixture://binary', blob: 'AAEC' },
        },
        {
          type: 'resource',
          resource: { uri: 'fixture://text', text: 'Embedded text' },
        },
        {
          type: 'resource_link',
          uri: 'https://never-fetch.invalid',
          name: 'Output',
        },
        { type: 'future-format', data: 'AAAA', format: 'opaque' },
      ],
      structuredContent: { value: 42 },
      isError: true,
      _meta: { trace: 'preserved' },
    },
    {
      serverId: 'private-server-id',
      name: 'mixed',
      operationId: 'private-operation-id',
      generation: 'private-generation',
      display: { server: 'REA', name: 'mixed_1', output: 'output_2' },
    },
  )
}

test('model conversion preserves errors and supported media without duplicating structured text or fetching links', () => {
  const output = mcpToModelOutput({ output: result() })
  expect(output.type).toBe('content')
  if (output.type !== 'content') throw new Error('Expected mixed content')
  const text = output.value
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
  expect(text.match(/\{"value":42\}/g)).toHaveLength(1)
  expect(text).toContain('Different output')
  expect(text).toContain('Embedded text')
  expect(text).toContain('never-fetch.invalid')
  expect(text).toContain('future-format')
  expect(text).toContain('"isError":true')
  expect(text).not.toContain('For the user only')
  expect(text).toContain('"server":"REA"')
  expect(text).toContain('"name":"mixed_1"')
  expect(text).toContain('"output":"output_2"')
  expect(text).not.toContain('private-')
  expect(output.value.filter((part) => part.type === 'file')).toHaveLength(2)
  expect(text).not.toContain('"blob":"AAEC"')
})

test('bounded previews explicitly refer back to full output', () => {
  const output = result()
  output.result.content.push({ type: 'text', text: 'λ'.repeat(100_000) })
  output.result.content.push({
    type: 'image',
    mimeType: 'image/png',
    data: 'A'.repeat(300_000),
  })
  const model = mcpToModelOutput({ output })
  expect(JSON.stringify(model).length).toBeLessThan(40_000)
  expect(JSON.stringify(model)).toContain('read_mcp_output')
  expect(JSON.stringify(model)).toContain('output_2')
  expect(JSON.stringify(model)).not.toContain('private-')
  expect(
    JSON.stringify(mcpToModelOutput({ output: mcpResultPreview(output) })),
  ).not.toContain('private-')
  expect(makeOutputPreview(output)).toEqual(mcpResultPreview(output))
  expect(JSON.stringify(makeOutputPreview(output))).not.toContain('AAAA')
  expect(output.result.content.at(-1)?.data).toHaveLength(300_000)
})

test('offloading, reconstruction and removed-server history use identical result conversion', async () => {
  const output = result()
  const ctx = {
    storage: { get: async () => new Blob([JSON.stringify(output)]) },
  } as unknown as ActionCtx
  const original = {
    type: 'tool-removed_server_mixed',
    toolCallId: 'one',
    state: 'output-available',
    input: {},
    output: makeOutputPreview(output),
    outputRef: 'blob' as Id<'_storage'>,
  }
  const resolved = await resolveOffloadedOutput(ctx, original)
  expect(resolved).toMatchObject({ output, outputRef: undefined })
  const messages = [
    { id: 'message', role: 'assistant', parts: [resolved] },
  ] as unknown as UIMessage[]
  const tools = mcpHistoryTools(messages)
  const replay = await convertToModelMessages(messages, { tools })
  expect(hasToolResultMedia(replay)).toBe(true)
  const toolMessage = replay.find((message) => message.role === 'tool')
  expect(toolMessage?.content[0]).toMatchObject({
    type: 'tool-result',
    output: mcpToModelOutput({ output }),
  })
})

test('stored broker definitions replay as JSON documents without escaping their schemas', async () => {
  const output = JSON.stringify({
    view: 'input',
    inputSchemaComplete: true,
    hasMore: false,
    definition: {
      name: 'status',
      inputSchema: {
        type: 'object',
        properties: { value: { $ref: '#/$defs/value' } },
        $defs: { value: { type: 'string' } },
      },
    },
  })
  const ctx = {
    storage: { get: async () => new Blob([JSON.stringify(output)]) },
  } as unknown as ActionCtx
  const original = {
    type: 'tool-search_mcp_tools',
    toolCallId: 'definition',
    state: 'output-available',
    input: { tool: 'status' },
    output: 'preview',
    outputRef: 'blob' as Id<'_storage'>,
  }
  const resolved = await resolveOffloadedOutput(ctx, original)
  const messages = [
    { id: 'message', role: 'assistant', parts: [resolved] },
  ] as unknown as UIMessage[]
  const replay = await convertToModelMessages(messages, {
    tools: mcpHistoryTools(messages),
  })
  expect(
    replay.find((message) => message.role === 'tool')?.content[0],
  ).toMatchObject({
    output: { type: 'text', value: output },
  })
})

test('protocol prompt roles remain literal data and resources are scoped content', () => {
  const prompt = mcpResult(
    {
      content: [],
      messages: [
        { role: 'user', content: { type: 'text', text: '{{ literal }}' } },
      ],
      description: 'Prompt',
    },
    { serverId: 'one', name: 'get_prompt' },
  )
  expect(JSON.stringify(mcpToModelOutput({ output: prompt }))).toContain(
    '{{ literal }}',
  )
  expect(JSON.stringify(mcpToModelOutput({ output: prompt }))).toContain(
    'Prompt message role (literal server data): user',
  )
  const resource = mcpResult(
    {
      content: [],
      contents: [{ uri: 'fixture://one', text: 'Resource output' }],
    },
    { serverId: 'one', name: 'read_resource' },
  )
  expect(JSON.stringify(mcpToModelOutput({ output: resource }))).toContain(
    'Resource output',
  )
})

test('provider media fallback preserves full results while omitting rejected payloads', () => {
  const original = result()
  const converted = mcpToModelOutput({ output: original }, true)
  expect(converted.type).toBe('content')
  if (converted.type !== 'content') throw new Error('Expected MCP content')
  expect(converted.value.filter((part) => part.type === 'file')).toHaveLength(0)
  expect(JSON.stringify(converted)).toContain('Media omitted')
  expect(original.result.content[3].data).toBe('AAEC')
})

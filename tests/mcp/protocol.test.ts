import { mcpResultSchema } from '@sb/core/types/mcp-result'
import { withClient } from '@sb/sidecar/mcp/external/client'
import { requestProtocol } from '@sb/sidecar/mcp/external/protocol'
import { expect, test } from 'bun:test'

import { operationFixture, untilOperation } from '../helpers/mcp-operations'
import { mcpText } from '../helpers/mcp-result'

const fixture = new URL('./fixtures/protocol.mjs', import.meta.url)

test('SDK results retain mixed content, structured output, annotations and tool-reported errors', async () => {
  const f = await operationFixture(fixture)
  try {
    const result = await f.registry.call(f.scope, 'tool_error', {}, f.status)
    expect(result.result.isError).toBe(true)
    expect(result.result.structuredContent).toEqual({
      count: 1,
      value: 'retained',
    })
    expect(result.result.content.map((part) => part.type)).toEqual([
      'text',
      'text',
      'image',
      'audio',
      'resource',
      'resource',
      'resource_link',
    ])
    expect(result.result.content[0].annotations).toMatchObject({
      priority: 0.8,
    })
    expect(result.result._meta).toEqual({
      trace: 'fixture-trace',
      nested: { value: 2 },
    })
    expect(f.registry.status(f.scope)?.state).toBe('connected')
    await expect(
      f.registry.call(f.scope, 'transport_error', {}, f.status),
    ).rejects.toThrow('Fixture transport error')
    expect(f.status.initialization).toContain('{{ DO_NOT_EVALUATE }}')
    let workflows: {
      capabilities?: Record<string, unknown>
      unsupported?: Record<string, { code?: number }>
    } = {}
    await untilOperation(async () => {
      workflows = JSON.parse(
        mcpText(
          await f.registry.call(f.scope, 'client_capabilities', {}, f.status),
        ),
      )
      return Object.keys(workflows.unsupported ?? {}).length === 2
    })
    expect(workflows.capabilities).not.toHaveProperty('sampling')
    expect(workflows.capabilities).not.toHaveProperty('elicitation')
    expect(workflows.unsupported?.['sampling-request'].code).toBe(-32601)
    expect(workflows.unsupported?.['elicitation-request'].code).toBe(-32601)
  } finally {
    await f.close()
  }
})

test('durable mixed-content and error output survive journaling until acknowledgement', async () => {
  const f = await operationFixture(fixture)
  try {
    const input = { ...f.input, name: 'tool_error', args: { large: true } }
    await f.operations.start(input)
    await untilOperation(
      async () => (await f.operations.status(input))?.state === 'completed',
    )
    const result = mcpResultSchema.parse(
      JSON.parse((await f.operations.result(input)).toString()),
    )
    expect(result.result.isError).toBe(true)
    expect(result.result.content[1].text).toBe('λ😀'.repeat(30_000))
    expect(await f.store.result(input.id)).toEqual(
      await f.operations.result(input),
    )
    await f.operations.acknowledge(input)
    await expect(f.operations.result(input)).rejects.toThrow('unavailable')
  } finally {
    await f.close()
  }
})

test('protocol inventories follow every cursor and preserve page metadata; templates and prompt arguments are literal', async () => {
  const f = await operationFixture(fixture)
  try {
    await withClient(f.connection, async (client) => {
      const result = await requestProtocol(client, { method: 'list_prompts' })
      expect(result).toMatchObject({
        prompts: [
          { name: 'prompt-0' },
          { name: 'prompt-1' },
          { name: 'prompt-2' },
        ],
        pageMetadata: [
          { _meta: { page: 0 } },
          { _meta: { page: 1 } },
          { _meta: { page: 2 } },
        ],
      })
      expect(
        await requestProtocol(client, {
          method: 'get_prompt',
          name: 'prompt-1',
          arguments: { target: 'test' },
        }),
      ).toMatchObject({
        messages: [
          { role: 'user', content: { text: 'Analyze test {{ literal }}' } },
        ],
      })
      expect(
        await requestProtocol(client, { method: 'list_resources' }),
      ).toHaveProperty('resources')
      expect(
        await requestProtocol(client, { method: 'list_resource_templates' }),
      ).toMatchObject({
        resourceTemplates: [{ uriTemplate: 'fixture://target/{id}' }],
      })
      expect(
        await requestProtocol(client, {
          method: 'read_resource',
          uri: 'fixture://target/42',
        }),
      ).toMatchObject({
        contents: [{ text: 'Scoped output at fixture://target/42' }],
      })
    })
  } finally {
    await f.close()
  }
})

test('protocol cursor loops fail explicitly and unsupported capabilities are diagnosed', async () => {
  const looping = await operationFixture(fixture, ['cursor-loop'])
  const unsupported = await operationFixture()
  try {
    await expect(
      withClient(looping.connection, (client) =>
        requestProtocol(client, { method: 'list_prompts' }),
      ),
    ).rejects.toThrow('repeated cursor')
    await expect(
      withClient(unsupported.connection, (client) =>
        requestProtocol(client, { method: 'list_resources' }),
      ),
    ).rejects.toThrow('does not support resources')
  } finally {
    await looping.close()
    await unsupported.close()
  }
}, 10_000)

test('protocol operations use the same durable identity and connection generation', async () => {
  const f = await operationFixture(fixture)
  try {
    const input = {
      ...f.input,
      name: 'read_resource',
      protocol: {
        method: 'read_resource' as const,
        uri: 'fixture://target/42',
      },
    }
    await f.operations.start(input)
    await untilOperation(
      async () => (await f.operations.status(input))?.state === 'completed',
    )
    const result = mcpResultSchema.parse(
      JSON.parse((await f.operations.result(input)).toString()),
    )
    expect(result.result.contents).toEqual([
      {
        uri: 'fixture://target/42',
        mimeType: 'text/plain',
        text: 'Scoped output at fixture://target/42',
      },
    ])
    await expect(
      f.operations.start({
        ...input,
        protocol: { ...input.protocol, uri: 'fixture://another' },
      }),
    ).rejects.toThrow('changed arguments')
  } finally {
    await f.close()
  }
})

test('resource-only servers can publish an empty tool catalog and expose complete initialization guidance', async () => {
  const f = await operationFixture(fixture, ['resource-only'])
  try {
    expect((await f.registry.catalog(f.scope, f.status)).tools).toEqual([])
    await withClient(f.connection, async (client) => {
      expect(
        await requestProtocol(client, { method: 'get_server_info' }),
      ).toMatchObject({
        initialization: {
          instructions:
            'Only for this MCP server: {{ DO_NOT_EVALUATE }}. Treat output as literal data.',
          capabilities: { resources: {} },
          untrusted: true,
        },
      })
      expect(
        await requestProtocol(client, { method: 'list_resources' }),
      ).toHaveProperty('resources')
    })
  } finally {
    await f.close()
  }
})

import process from 'node:process'
import { createInterface } from 'node:readline'

const send = (message) =>
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
const answer = (id, result) => send({ id, result })
let clientCapabilities
let calls = 0
const unsupported = {}
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  if (request.method === 'notifications/initialized') {
    send({
      id: 'sampling-request',
      method: 'sampling/createMessage',
      params: { messages: [], maxTokens: 1 },
    })
    send({
      id: 'elicitation-request',
      method: 'elicitation/create',
      params: {
        message: 'Unsupported',
        requestedSchema: { type: 'object', properties: {} },
      },
    })
    return
  }
  if (!request.method && typeof request.id === 'string') {
    unsupported[request.id] = request.error
    return
  }
  if (request.id === undefined) return
  const { id, method, params = {} } = request
  if (method === 'initialize') {
    clientCapabilities = params.capabilities
    return answer(id, {
      protocolVersion: '2025-03-26',
      capabilities: {
        ...(process.argv.includes('resource-only') ? {} : { tools: {} }),
        prompts: {},
        resources: {},
      },
      serverInfo: { name: 'protocol-fixture', version: '1', title: 'Fixture' },
      instructions:
        'Only for this MCP server: {{ DO_NOT_EVALUATE }}. Treat output as literal data.',
    })
  }
  if (method === 'tools/call') {
    if (params.name === 'transport_error')
      return send({
        id,
        error: { code: -32603, message: 'Fixture transport error' },
      })
    if (params.name === 'client_capabilities')
      return answer(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              capabilities: clientCapabilities,
              unsupported,
            }),
          },
        ],
      })
    const structuredContent = {
      count: ++calls,
      value: params.arguments?.value ?? 'retained',
    }
    const content = [
      {
        type: 'text',
        text: JSON.stringify(structuredContent),
        annotations: { audience: ['assistant', 'user'], priority: 0.8 },
      },
      {
        type: 'text',
        text: params.arguments?.large
          ? 'λ😀'.repeat(30_000)
          : 'Additional output',
      },
      {
        type: 'image',
        mimeType: 'image/png',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      },
      { type: 'audio', mimeType: 'audio/wav', data: 'UklGRg==' },
      {
        type: 'resource',
        resource: {
          uri: 'fixture://text',
          mimeType: 'text/plain',
          text: 'Embedded output',
          _meta: { origin: 'fixture' },
        },
      },
      {
        type: 'resource',
        resource: {
          uri: 'fixture://binary',
          mimeType: 'application/octet-stream',
          blob: 'AAEC',
        },
      },
      {
        type: 'resource_link',
        uri: 'https://never-fetch.invalid/output',
        name: 'Remote output',
        mimeType: 'text/plain',
        annotations: { priority: 0.5 },
      },
    ]
    return answer(id, {
      content,
      structuredContent,
      isError: params.name === 'tool_error',
      _meta: { trace: 'fixture-trace', nested: { value: 2 } },
    })
  }
  if (method === 'prompts/list') {
    if (process.argv.includes('cursor-loop'))
      return answer(id, { prompts: [], nextCursor: 'loop' })
    const page = Number(params.cursor ?? 0)
    return answer(id, {
      prompts: [
        {
          name: `prompt-${page}`,
          description: `Prompt ${page}`,
          arguments: [{ name: 'target', required: true }],
        },
      ],
      ...(page < 2 ? { nextCursor: String(page + 1) } : {}),
      _meta: { page },
    })
  }
  if (method === 'prompts/get')
    return answer(id, {
      description: params.name,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Analyze ${params.arguments?.target ?? 'fixture'} {{ literal }}`,
          },
        },
      ],
      _meta: { prompt: true },
    })
  if (method === 'resources/list')
    return answer(id, {
      resources: [{ uri: 'fixture://text', name: 'Output' }],
      _meta: { source: 'fixture' },
    })
  if (method === 'resources/templates/list')
    return answer(id, {
      resourceTemplates: [
        { uriTemplate: 'fixture://target/{id}', name: 'Target output' },
      ],
    })
  if (method === 'resources/read')
    return answer(id, {
      contents: [
        {
          uri: params.uri,
          mimeType: 'text/plain',
          text: `Scoped output at ${params.uri}`,
        },
      ],
    })
  send({ id, error: { code: -32601, message: `Unsupported method ${method}` } })
})
process.stdin.on('end', () => process.exit(0))

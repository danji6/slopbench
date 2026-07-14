import type { McpConnection, McpToolMeta } from '@sb/core/types'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  SSEClientTransport,
  type SSEClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

function authHeaders(apiKey?: string): Record<string, string> | undefined {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined
}

function createTransport({ url, transport, apiKey }: McpConnection): Transport {
  const target = new URL(url)
  const headers = authHeaders(apiKey)

  if (transport === 'ws') {
    return new WebSocketClientTransport(target)
  }

  if (transport === 'http') {
    return new StreamableHTTPClientTransport(target, {
      requestInit: headers ? { headers } : undefined,
    })
  }

  const eventSourceInit = headers
    ? ({
        fetch: (input: string | URL, init?: RequestInit) =>
          fetch(input, {
            ...init,
            headers: {
              ...(init?.headers as Record<string, string>),
              ...headers,
            },
          }),
      } as SSEClientTransportOptions['eventSourceInit'])
    : undefined

  return new SSEClientTransport(target, {
    requestInit: headers ? { headers } : undefined,
    eventSourceInit,
  })
}

async function withClient<T>(
  connection: McpConnection,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ name: 'chat-sidecar', version: '1.0.0' })
  const transport = createTransport(connection)
  try {
    await client.connect(transport)
    return await fn(client)
  } finally {
    await client.close().catch(() => {})
  }
}

export async function listExternalTools(
  connection: McpConnection,
): Promise<McpToolMeta[]> {
  return withClient(connection, async (client) => {
    const { tools } = await client.listTools()
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      // Serialize: JSON Schema uses '$'-prefixed keys that Convex rejects.
      inputSchema: tool.inputSchema
        ? JSON.stringify(tool.inputSchema)
        : undefined,
    }))
  })
}

export async function callExternalTool(
  connection: McpConnection,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  return withClient(connection, async (client) => {
    const result = await client.callTool({ name, arguments: args }, undefined, {
      signal,
    })
    const content = (result.content ?? []) as Array<{
      type: string
      text?: string
    }>
    const text = content
      .filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join('\n')
    if (result.isError) throw new Error(text || 'Tool failed')
    return text
  })
}

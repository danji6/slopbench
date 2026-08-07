import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  SSEClientTransport,
  type SSEClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { APP_ID } from '@sb/core/const'
import {
  type McpConnection,
  type McpDialedTransport,
  type McpToolMeta,
  mcpTransportCandidates,
} from '@sb/core/types'

const negotiated = new Map<string, McpDialedTransport>()

function authHeaders(apiKey?: string): Record<string, string> | undefined {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined
}

function createTransport(
  { url, apiKey }: McpConnection,
  transport: McpDialedTransport,
): Transport {
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

/** Candidate transports, preferring one this server already answered on. */
function candidatesFor({
  url,
  transport,
}: McpConnection): readonly McpDialedTransport[] {
  const candidates = mcpTransportCandidates(transport)
  const known = negotiated.get(url)
  if (!known || !candidates.includes(known)) return candidates
  return [known, ...candidates.filter((candidate) => candidate !== known)]
}

function isAuthFailure(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code
  if (typeof code === 'number') return code === 401 || code === 403
  return (
    error instanceof Error &&
    /\b(401|403|unauthorized|forbidden)\b/i.test(error.message)
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type Negotiated<T> = { value: T; transport: McpDialedTransport }

/** Connects over the first transport the server accepts and runs `fn` on it. */
async function withClient<T>(
  connection: McpConnection,
  fn: (client: Client) => Promise<T>,
): Promise<Negotiated<T>> {
  const candidates = candidatesFor(connection)
  let firstError: unknown

  for (const transport of candidates) {
    const client = new Client({ name: APP_ID, version: '1.0.0' })

    try {
      await client.connect(createTransport(connection, transport))
    } catch (err) {
      await client.close().catch(() => {})
      firstError ??= err
      if (isAuthFailure(err)) break
      continue
    }

    negotiated.set(connection.url, transport)
    try {
      return { value: await fn(client), transport }
    } finally {
      await client.close().catch(() => {})
    }
  }

  negotiated.delete(connection.url)
  if (candidates.length === 1 || isAuthFailure(firstError)) throw firstError
  throw new Error(
    `Could not connect over ${candidates.join(' or ')}: ${errorMessage(firstError)}`,
  )
}

export async function listExternalTools(
  connection: McpConnection,
): Promise<Negotiated<McpToolMeta[]>> {
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
  const { value } = await withClient(connection, async (client) => {
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
  return value
}

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

import { localTransport } from './stdio'

const negotiated = new Map<string, McpDialedTransport>()

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

function authHeaders(apiKey?: string): Record<string, string> | undefined {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined
}

export function createTransport(
  connection: McpConnection,
  transport: McpDialedTransport,
): Transport {
  if (transport === 'stdio') return localTransport(connection)
  const { url, apiKey } = connection
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

export type ConnectedClient = {
  client: Client
  transport: McpDialedTransport
}

/** Connects once; its caller owns the complete client lifetime. */
export async function connectExternalClient(
  connection: McpConnection,
  stderr?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<ConnectedClient> {
  const candidates = candidatesFor(connection)
  let firstError: unknown
  for (const transport of candidates) {
    signal?.throwIfAborted()
    const client = new Client({ name: APP_ID, version: '1.0.0' })
    const channel = createTransport(connection, transport)
    if ('stderr' in channel) {
      const stream = channel.stderr as NodeJS.ReadableStream | null
      stream?.on('data', (chunk) => stderr?.(String(chunk)))
    }
    try {
      await withTimeout(
        client.connect(channel),
        connection.startupTimeoutMs ?? dialTimeoutMs(connection),
        signal,
      )
    } catch (err) {
      await client.close().catch(() => {})
      firstError ??= err
      if (signal?.aborted || isAuthFailure(err)) break
      continue
    }
    negotiated.set(connection.url, transport)
    return { client, transport }
  }
  negotiated.delete(connection.url)
  if (candidates.length === 1 || isAuthFailure(firstError)) throw firstError
  throw new Error(
    `Could not connect over ${candidates.join(' or ')}: ${errorMessage(firstError)}`,
  )
}

/** Runs a settings discovery in an isolated, explicitly requested probe. */
async function withClient<T>(
  connection: McpConnection,
  fn: (client: Client) => Promise<T>,
): Promise<Negotiated<T>> {
  const connected = await connectExternalClient(connection)
  try {
    return { value: await fn(connected.client), transport: connected.transport }
  } finally {
    await connected.client.close()
  }
}

function dialTimeoutMs(connection: McpConnection): number {
  return (
    Number(process.env.MCP_DIAL_TIMEOUT_MS) ||
    (connection.transport === 'stdio' ? 30_000 : 10_000)
  )
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      cleanup()
      reject(signal?.reason ?? new Error('MCP startup cancelled'))
    }
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', aborted)
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out after ${ms}ms`))
    }, ms)
    signal?.addEventListener('abort', aborted, { once: true })
    if (signal?.aborted) aborted()
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}

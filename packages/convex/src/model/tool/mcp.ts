import type { McpServer } from '@sb/core/types'

import { ToolError, extractErrorMessage, toolFailure } from '../../errors'
import type { McpManifestEntry } from './manifest'
import { type WebToolSettings, enabledMcpServers } from './settings'

const DEFAULT_SIDECAR_URL = 'http://localhost:3212'

export function getMcpUrl(
  sidecarUrl = process.env.SIDECAR_URL ?? DEFAULT_SIDECAR_URL,
): string {
  const url = new URL(sidecarUrl)
  const pathname = url.pathname.replace(/\/$/, '')
  url.pathname = pathname.endsWith('/mcp') ? pathname : `${pathname}/mcp`
  return url.toString()
}

/** Absolute URL for a sidecar route. */
export function getSidecarUrl(
  path: string,
  sidecarUrl = process.env.SIDECAR_URL ?? DEFAULT_SIDECAR_URL,
): string {
  return new URL(path, sidecarUrl).toString()
}

export async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  let closeClient: (() => Promise<void>) | undefined

  try {
    const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
    ])

    const client = new Client({ name: 'convex', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(getMcpUrl()))

    closeClient = () => client.close()

    await client.connect(transport)

    const result = await client.callTool({ name, arguments: args }, undefined, {
      signal,
    })
    const content = result.content as Array<{ type: string; text: string }>
    const text = content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n')

    if (result.isError) throw new ToolError(text || 'Tool call failed')

    return text
  } catch (error) {
    // ToolError rethrown here for propagation
    throw error instanceof ToolError
      ? error
      : new ToolError(extractErrorMessage(error))
  } finally {
    try {
      await closeClient?.()
    } catch {
      // Keep the stream alive, no-op
    }
  }
}

const EMPTY_OBJECT_SCHEMA = { type: 'object' as const, properties: {} }

function parseInputSchema(raw: string | undefined): Record<string, unknown> {
  if (!raw) return EMPTY_OBJECT_SCHEMA
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return EMPTY_OBJECT_SCHEMA
  }
}

async function callExternalMcpTool(
  server: McpServer,
  name: string,
  args: unknown,
  signal?: AbortSignal,
): Promise<string> {
  try {
    const response = await fetch(getSidecarUrl('/mcp-ext/call'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: server.url,
        transport: server.transport,
        apiKey: server.apiKey,
        name,
        args,
      }),
      signal,
    })

    const data = (await response.json()) as { text?: string; error?: string }
    if (!response.ok || data.error) {
      throw new ToolError(data.error ?? `HTTP ${response.status}`)
    }
    return data.text ?? ''
  } catch (error) {
    toolFailure(error)
  }
}

export async function createExternalMcpTool(
  entry: McpManifestEntry,
  settings?: WebToolSettings,
) {
  const { tool, jsonSchema } = await import('ai')
  const schema = parseInputSchema(entry.inputSchema) as Parameters<
    typeof jsonSchema
  >[0]
  return tool({
    description: entry.description,
    inputSchema: jsonSchema(schema),
    execute: async (args, { abortSignal }) => {
      const server = enabledMcpServers(settings).find(
        (candidate) => candidate.id === entry.serverId,
      )
      if (!server) {
        throw new ToolError(
          `The MCP server providing "${entry.name}" is no longer configured.`,
        )
      }
      return callExternalMcpTool(server, entry.toolName, args, abortSignal)
    },
  })
}

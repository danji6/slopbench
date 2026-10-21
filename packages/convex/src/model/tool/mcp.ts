import { mcpConnectionSchema } from '@sb/core/types'
import type { McpRuntimeScope, McpRuntimeStatus } from '@sb/core/types'
import type { McpServer } from '@sb/core/types'
import { mcpApprovalKey, parseMcpInputSchema } from '@sb/core/types/mcp-catalog'

import type { Id } from '../../_generated/dataModel'
import { ToolError, extractErrorMessage, toolFailure } from '../../errors'
import { isToolAutoApproved } from '../../lib/tool/approval'
import type { ToolApprovals } from '../../types'
import { sidecarUrl as defaultSidecarUrl } from '../sidecar'
import { sidecarRequest } from '../sidecarTransport'
import type { McpManifestEntry } from './manifest'
import { loadMcpDefinition } from './mcpDefinition'
import {
  type McpOperationContext,
  executeMcpOperation,
  existingMcpOperation,
  findMcpOperation,
} from './mcpOperation'
import { enabledMcpServers } from './settings'

export function getMcpUrl(sidecarUrl = defaultSidecarUrl()): string {
  const url = new URL(sidecarUrl)
  const pathname = url.pathname.replace(/\/$/, '')
  url.pathname = pathname.endsWith('/mcp') ? pathname : `${pathname}/mcp`
  return url.toString()
}

/** Absolute URL for a sidecar route. */
export function getSidecarUrl(
  path: string,
  sidecarUrl = defaultSidecarUrl(),
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
    const transport = new StreamableHTTPClientTransport(new URL(getMcpUrl()), {
      requestInit: sidecarRequest(),
    })

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

export type RuntimeAuthorization = {
  runtimeId: Id<'mcpRuntimes'>
  scope: McpRuntimeScope
  bootId?: string
  generation?: string
  expiresAt: number
}

type Failed = (
  runtimeId: Id<'mcpRuntimes'>,
  key: string,
  reason: string,
) => Promise<void>

type Connected = (
  runtimeId: Id<'mcpRuntimes'>,
  key: string,
  bootId: string,
  generation: string,
) => Promise<boolean>

async function externalRequest<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    getSidecarUrl(path),
    sidecarRequest({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    }),
  )
  const data = (await response.json()) as T & { error?: string }
  if (!response.ok || data.error)
    throw new ToolError(data.error ?? `HTTP ${response.status}`)
  return data
}

async function callExternalMcpTool(
  server: McpServer,
  name: string,
  args: unknown,
  signal?: AbortSignal,
  runtime?: RuntimeAuthorization,
  connected?: Connected,
  failed?: Failed,
  operation?: {
    context: McpOperationContext
    toolCallId: string
    name: string
  },
): Promise<string> {
  try {
    if (!runtime) {
      if (server.transport === 'stdio')
        throw new ToolError(
          'Local MCP requires an authorized session execution',
        )
      const data = await externalRequest<{ text: string }>(
        '/mcp-ext/call',
        { ...mcpConnectionSchema.parse(server), name, args },
        signal,
      )
      return data.text
    }

    let status: McpRuntimeStatus
    try {
      status = await externalRequest<McpRuntimeStatus>(
        '/mcp-ext/connect',
        { ...runtime, connection: mcpConnectionSchema.parse(server) },
        signal,
      )
    } catch (error) {
      await failed?.(
        runtime.runtimeId,
        runtime.scope.key,
        error instanceof Error ? error.message : 'MCP connection lost',
      )
      throw error
    }

    const accepted = await connected?.(
      runtime.runtimeId,
      runtime.scope.key,
      status.bootId,
      status.generation,
    )
    if (!accepted) {
      await externalRequest('/mcp-ext/disconnect', {
        scope: runtime.scope,
      }).catch(() => {})
      throw new ToolError('MCP execution was revoked during connection')
    }

    if (operation) {
      return await executeMcpOperation(operation.context, {
        runtime,
        bootId: status.bootId,
        generation: status.generation,
        serverKey: server.id,
        toolName: name,
        name: operation.name,
        args,
        toolCallId: operation.toolCallId,
        signal,
      })
    }

    const data = await externalRequest<{ text: string }>(
      '/mcp-ext/call',
      {
        scope: runtime.scope,
        bootId: status.bootId,
        generation: status.generation,
        expiresAt: Date.now() + 30_000,
        name,
        args,
      },
      signal,
    )
    return data.text
  } catch (error) {
    toolFailure(error)
  }
}

export async function createExternalMcpTool(
  entry: McpManifestEntry,
  servers: McpServer[],
  current?: () => Promise<{
    server: McpServer
    readOnly: boolean
    runtime?: RuntimeAuthorization
  } | null>,
  connected?: Connected,
  approvals?: () => Promise<ToolApprovals | undefined>,
  failed?: Failed,
  operationContext?: McpOperationContext,
) {
  const { tool, jsonSchema } = await import('ai')

  const definition =
    entry.definitionRef && operationContext
      ? await loadMcpDefinition(
          operationContext.ctx,
          entry.definitionRef,
          operationContext.execution,
        )
      : undefined

  const diagnostic = entry.diagnostic ?? definition?.diagnostic
  if (diagnostic) throw new ToolError(diagnostic)

  const schema = parseMcpInputSchema(
    definition?.inputSchema ?? entry.inputSchema,
  ) as Parameters<typeof jsonSchema>[0]

  const { mcpInputValidator } = await import('@sb/core/mcp-schema-validation')
  const validate = mcpInputValidator(
    definition?.inputSchema ?? entry.inputSchema!,
  )

  return tool({
    description: entry.description ?? definition?.description,
    inputSchema: jsonSchema(schema, {
      validate: (input) => {
        const result = validate(input)
        return result.valid
          ? { success: true, value: result.data }
          : {
              success: false,
              error: new ToolError(
                `MCP arguments rejected: ${result.errorMessage}`,
              ),
            }
      },
    }),
    needsApproval: async (input, { toolCallId }) => {
      if (operationContext) {
        const existing = await findMcpOperation(operationContext, {
          serverKey: entry.serverId,
          toolName: entry.toolName,
          name: entry.name,
          args: input,
          toolCallId,
        })
        if (existing) return false
      }
      const live = current ? await current() : undefined
      const server =
        live?.server ?? servers.find((server) => server.id === entry.serverId)
      if (server?.transport !== 'stdio') return false
      const approvalName = operationContext?.broker
        ? mcpApprovalKey(operationContext.broker)!
        : entry.name
      return !isToolAutoApproved(approvalName, input, await approvals?.())
    },
    execute: async (args, { abortSignal, toolCallId }) => {
      if (operationContext) {
        const existing = await existingMcpOperation(operationContext, {
          serverKey: entry.serverId,
          toolName: entry.toolName,
          name: entry.name,
          args,
          toolCallId,
          signal: abortSignal,
        })
        if (existing) return existing.output
      }
      const live = current ? await current() : undefined
      const server = current
        ? live?.server
        : enabledMcpServers(servers).find(
            (candidate) => candidate.id === entry.serverId,
          )
      if (!server) {
        throw new ToolError(
          `The MCP server providing "${entry.name}" is no longer configured.`,
        )
      }

      const configuredTool = server.tools?.find(
        (candidate) => candidate.name === entry.toolName,
      )
      if (live?.readOnly && configuredTool?.allowInReadOnly === false) {
        throw new ToolError(
          'This external tool is not allowed in read-only mode.',
        )
      }

      if (current && !configuredTool)
        throw new ToolError('This external tool is no longer configured.')

      return callExternalMcpTool(
        server,
        entry.toolName,
        args,
        abortSignal,
        live?.runtime,
        connected,
        failed,
        operationContext
          ? { context: operationContext, toolCallId, name: entry.name }
          : undefined,
      )
    },
  })
}

import type { McpServer } from '@sb/core/types'
import { mcpApprovalKey, parseMcpInputSchema } from '@sb/core/types/mcp-catalog'

import { ToolError, extractErrorMessage, toolFailure } from '../../errors'
import { isToolAutoApproved } from '../../lib/tool/approval'
import type { ToolApprovals } from '../../types'
import { sidecarUrl as defaultSidecarUrl } from '../sidecar'
import { sidecarRequest } from '../sidecarTransport'
import type { McpManifestEntry } from './manifest'
import { connectMcpRuntime } from './mcpConnection'
import type {
  McpConnected as Connected,
  McpFailed as Failed,
  RuntimeAuthorization,
} from './mcpConnection'
import { loadMcpDefinition } from './mcpDefinition'
import {
  type McpOperationContext,
  executeMcpOperation,
  existingMcpOperation,
  findMcpOperation,
} from './mcpOperation'
import { mcpToModelOutput } from './mcpOutput'

export { getSidecarUrl, externalRequest } from './mcpConnection'
export type { RuntimeAuthorization } from './mcpConnection'

export function getMcpUrl(sidecarUrl = defaultSidecarUrl()): string {
  const url = new URL(sidecarUrl)
  const pathname = url.pathname.replace(/\/$/, '')
  url.pathname = pathname.endsWith('/mcp') ? pathname : `${pathname}/mcp`
  return url.toString()
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
) {
  try {
    if (!runtime || !operation)
      throw new ToolError(
        'MCP requires an authorized durable session execution',
      )

    const status = await connectMcpRuntime(
      server,
      runtime,
      { connected, failed },
      signal,
    )

    return executeMcpOperation(operation.context, {
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
    toModelOutput: (options) =>
      mcpToModelOutput(options, operationContext?.omitMedia),
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
      const server = live?.server
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

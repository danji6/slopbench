import {
  type McpBrokerCall,
  type McpBrokerSearch,
  mcpBrokerCallSchema,
  mcpBrokerSearchSchema,
} from '@sb/core/types/mcp-catalog'
import { TOOL_DESCRIPTIONS } from '@sb/core/types/tool-descriptions'

import { internal } from '../../_generated/api'
import { ToolError } from '../../errors'
import { createExternalMcpTool } from './mcp'
import { readMcpBrokerDefinition } from './mcpBrokerDefinition'
import { createMcpDefinitionReader } from './mcpDefinition'
import type { McpOperationContext } from './mcpOperation'
import { mcpToModelOutput } from './mcpOutput'

type ExternalParameters = Parameters<typeof createExternalMcpTool>

export type McpBrokerContext = {
  operation: McpOperationContext
  current: (
    serverKey: string,
    toolName?: string,
  ) => ReturnType<NonNullable<ExternalParameters[2]>>
  connected?: ExternalParameters[3]
  approvals?: ExternalParameters[4]
  failed?: ExternalParameters[5]
}

type BrokerContext = McpBrokerContext & {
  readDefinition: ReturnType<typeof createMcpDefinitionReader>
}

/** Exposes two stable schemas while target definitions and authorization remain live. */
export async function createMcpBrokerTools(context: McpBrokerContext) {
  const { tool } = await import('ai')
  const broker: BrokerContext = {
    ...context,
    readDefinition: createMcpDefinitionReader(
      context.operation.ctx,
      context.operation.execution,
    ),
  }

  return {
    search_mcp_tools: tool({
      description: TOOL_DESCRIPTIONS.search_mcp_tools,
      inputSchema: mcpBrokerSearchSchema,
      toModelOutput: (options) => mcpToModelOutput(options),
      execute: (input) => searchTools(broker, input),
    }),
    call_mcp_tool: tool({
      toModelOutput: (options) =>
        mcpToModelOutput(options, context.operation.omitMedia),
      description: TOOL_DESCRIPTIONS.call_mcp_tool,
      inputSchema: mcpBrokerCallSchema,
      needsApproval: async (input, options) => {
        const target = await targetTool(broker, input)
        return typeof target.needsApproval === 'function'
          ? target.needsApproval(input.arguments, options)
          : !!target.needsApproval
      },
      execute: async (input, options) => {
        const target = await targetTool(broker, input)
        return target.execute!(input.arguments, options)
      },
    }),
  }
}

async function targetTool(context: BrokerContext, input: McpBrokerCall) {
  const { ctx, execution } = context.operation

  const target = await ctx.runQuery(internal.mcpBroker._target, {
    ...execution,
    tool: input.tool,
  })
  const definition = await context.readDefinition(target.tool)
  if (definition.diagnostic) throw new ToolError(definition.diagnostic)

  await validateArguments(definition.inputSchema, input.arguments)

  return createExternalMcpTool(
    {
      name: 'call_mcp_tool',
      serverId: target.server.id,
      toolName: target.tool.name,
      description: definition.description,
      inputSchema: definition.inputSchema,
    },
    [],
    () => context.current(target.server.id, target.tool.name),
    context.connected,
    context.approvals,
    context.failed,
    {
      ...context.operation,
      catalogToolId: target.tool._id,
      broker: input,
    },
  )
}

async function searchTools(context: BrokerContext, input: McpBrokerSearch) {
  const { ctx, execution } = context.operation

  if (!input.tool) {
    const { ensureIntegrationCatalog } = await import('./integrationCatalog')
    const server = input.server
      ? await ctx.runQuery(internal.mcpBroker._server, {
          ...execution,
          server: input.server,
        })
      : undefined
    await ensureIntegrationCatalog(context, server?.recordId)
    return ctx.runMutation(internal.mcpBroker._search, {
      ...execution,
      query: input.query,
      server: input.server,
      cursor: input.cursor,
      limit: input.limit,
    })
  }

  return readMcpBrokerDefinition(
    context.operation,
    input,
    context.readDefinition,
  )
}

async function validateArguments(schema: string, input: unknown) {
  const { mcpInputValidator } = await import('@sb/core/mcp-schema-validation')
  const validate = mcpInputValidator(schema)
  const result = validate(input)
  if (!result.valid)
    throw new ToolError(`MCP arguments rejected: ${result.errorMessage}`)
}

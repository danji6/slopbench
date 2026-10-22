import {
  type McpBrokerCall,
  type McpBrokerSearch,
  mcpBrokerCallSchema,
  mcpBrokerSearchSchema,
  mcpDefinitionSchema,
} from '@sb/core/types/mcp-catalog'
import { TOOL_DESCRIPTIONS } from '@sb/core/types/tool-descriptions'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import { ToolError } from '../../errors'
import { createExternalMcpTool } from './mcp'
import { loadMcpDefinition } from './mcpDefinition'
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

/** Exposes two stable schemas while target definitions and authorization remain live. */
export async function createMcpBrokerTools(context: McpBrokerContext) {
  const { tool } = await import('ai')

  return {
    search_mcp_tools: tool({
      description: TOOL_DESCRIPTIONS.search_mcp_tools,
      inputSchema: mcpBrokerSearchSchema,
      execute: (input) => searchTools(context, input),
    }),
    call_mcp_tool: tool({
      toModelOutput: (options) =>
        mcpToModelOutput(options, context.operation.omitMedia),
      description: TOOL_DESCRIPTIONS.call_mcp_tool,
      inputSchema: mcpBrokerCallSchema,
      needsApproval: async (input, options) => {
        const target = await targetTool(context, input)
        return typeof target.needsApproval === 'function'
          ? target.needsApproval(input.arguments, options)
          : !!target.needsApproval
      },
      execute: async (input, options) => {
        const target = await targetTool(context, input)
        return target.execute!(input.arguments, options)
      },
    }),
  }
}

async function targetTool(context: McpBrokerContext, input: McpBrokerCall) {
  const { ctx, execution } = context.operation

  const target = await ctx.runQuery(internal.mcpCatalogs._target, {
    ...execution,
    serverId: input.serverId as Id<'mcpServers'>,
    toolId: input.toolId as Id<'mcpCatalogTools'>,
  })
  const definition = await loadMcpDefinition(
    ctx,
    target.tool.definitionRef,
    execution,
  )
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
      broker: {
        serverId: target.tool.serverId,
        toolId: target.tool._id,
        arguments: input.arguments,
      },
    },
  )
}

async function searchTools(context: McpBrokerContext, input: McpBrokerSearch) {
  const { ctx, execution } = context.operation

  if (!input.toolId) {
    return ctx.runQuery(internal.mcpCatalogs._search, {
      ...execution,
      query: input.query,
      serverId: input.serverId as Id<'mcpServers'> | undefined,
      cursor: input.cursor,
      limit: input.limit,
    })
  }

  return readDefinition(context, input)
}

async function readDefinition(
  context: McpBrokerContext,
  input: McpBrokerSearch,
) {
  const { ctx, execution } = context.operation
  if (!input.serverId)
    throw new ToolError('A serverId is required to read a definition')

  const target = await ctx.runQuery(internal.mcpCatalogs._target, {
    ...execution,
    serverId: input.serverId as Id<'mcpServers'>,
    toolId: input.toolId as Id<'mcpCatalogTools'>,
    forDefinition: true,
  })

  const definition = mcpDefinitionSchema.parse(
    await loadMcpDefinition(ctx, target.tool.definitionRef, execution),
  )

  const text = JSON.stringify(definition)

  if (input.offset > text.length)
    throw new ToolError('MCP definition offset is out of range')

  const end = Math.min(text.length, input.offset + input.length)

  return {
    name: definition.name,
    diagnostic: definition.diagnostic,
    text: text.slice(input.offset, end),
    offset: input.offset,
    nextOffset: end < text.length ? end : null,
    totalCharacters: text.length,
    complete: input.offset === 0 && end === text.length,
  }
}

async function validateArguments(schema: string, input: unknown) {
  const { mcpInputValidator } = await import('@sb/core/mcp-schema-validation')
  const validate = mcpInputValidator(schema)
  const result = validate(input)
  if (!result.valid)
    throw new ToolError(`MCP arguments rejected: ${result.errorMessage}`)
}

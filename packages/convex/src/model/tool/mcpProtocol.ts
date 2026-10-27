import {
  mcpOutputReadSchema,
  mcpProtocolApprovalKey,
  mcpProtocolBrokerSchema,
} from '@sb/core/types/mcp-protocol'
import type { McpProtocolRequest } from '@sb/core/types/mcp-protocol'
import { TOOL_DESCRIPTIONS } from '@sb/core/types/tool-descriptions'

import { internal } from '../../_generated/api'
import { ToolError } from '../../errors'
import { isToolAutoApproved } from '../../lib/tool/approval'
import type { McpBrokerContext } from './mcpBroker'
import { connectMcpRuntime } from './mcpConnection'
import {
  executeMcpOperation,
  existingMcpOperation,
  findMcpOperation,
} from './mcpOperation'
import { mcpToModelOutput } from './mcpOutput'

type Input = McpProtocolRequest & { server: string }

/** Uses session runtimes and durable operation identity for every protocol request. */
export async function createMcpProtocolTools(context: McpBrokerContext) {
  const { tool } = await import('ai')
  return {
    mcp_protocol: tool({
      description: TOOL_DESCRIPTIONS.mcp_protocol,
      inputSchema: mcpProtocolBrokerSchema,
      toModelOutput: (options) =>
        mcpToModelOutput(
          options,
          context.operation.omitMedia,
          context.operation.canReadOutput,
        ),
      needsApproval: async (input, { toolCallId }) => {
        const server = await protocolServer(context, input)
        const previous = await findMcpOperation(
          context.operation,
          invocation(server.id, input, toolCallId),
        )
        if (previous) return false
        if (server.transport !== 'stdio') return false
        // The available set already enforces live integration selection.
        if (server.integrationId) return false
        return !isToolAutoApproved(
          mcpProtocolApprovalKey(input, server.recordId!)!,
          input,
          await context.approvals?.(),
        )
      },
      execute: async (input, { toolCallId, abortSignal }) => {
        const server = await protocolServer(context, input)
        const call = invocation(server.id, input, toolCallId)
        const existing = await existingMcpOperation(context.operation, {
          ...call,
          signal: abortSignal,
        })
        if (existing) return existing.output
        const live = await context.current(server.id)
        if (!live) throw new ToolError('MCP protocol access revoked')
        if (!live.runtime) throw new ToolError('MCP runtime unavailable')
        const status = await connectMcpRuntime(
          live.server,
          live.runtime,
          context,
          abortSignal,
        )
        return executeMcpOperation(context.operation, {
          ...call,
          runtime: live.runtime,
          bootId: status.bootId,
          generation: status.generation,
          signal: abortSignal,
        })
      },
    }),
    read_mcp_output: tool({
      description: TOOL_DESCRIPTIONS.read_mcp_output,
      inputSchema: mcpOutputReadSchema,
      execute: async (input) => {
        const { readMcpOutput } = await import('../mcpOutputActions')
        return readMcpOutput(
          context.operation.ctx,
          context.operation.execution,
          input,
        )
      },
    }),
  }
}

function invocation(serverKey: string, input: Input, toolCallId: string) {
  const { server: _server, ...args } = input
  return {
    serverKey,
    name: 'mcp_protocol',
    toolName: input.method,
    protocolMethod: input.method,
    args,
    toolCallId,
  }
}

async function protocolServer(context: McpBrokerContext, input: Input) {
  return context.operation.ctx.runQuery(internal.mcpBroker._server, {
    ...context.operation.execution,
    server: input.server,
  })
}

import { type McpServer, type McpToolMeta, mcpToolName } from '@sb/core/types'
import { mcpServerSelection } from '@sb/core/types/mcp-catalog'

/** Applies server selection and per-target restrictions equally to broker and direct calls. */
export function isMcpToolSelected(
  agent: { tools?: string[] },
  server: McpServer,
  tool: McpToolMeta,
) {
  if (tool.enabled === false || tool.diagnostic) return false
  if (agent.tools?.includes(mcpToolName(server, tool))) return true
  return (
    server.brokerEnabled === true &&
    !!agent.tools?.includes(mcpServerSelection(server))
  )
}

/** Allows schema inspection for selected tools even when compilation disabled execution. */
export function canReadMcpTool(
  agent: { tools?: string[] },
  server: McpServer,
  tool: McpToolMeta,
) {
  return isMcpToolSelected(agent, server, { ...tool, diagnostic: undefined })
}

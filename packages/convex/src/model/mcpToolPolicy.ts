import { type McpServer, type McpToolMeta, mcpToolName } from '@sb/core/types'
import { mcpServerSelection } from '@sb/core/types/mcp-catalog'

/** Applies server selection and per-target restrictions equally to broker and direct calls. */
export function isMcpToolSelected(
  agent: { tools?: string[] },
  server: McpServer,
  tool: McpToolMeta,
) {
  if (!server.enabled) return false
  if (tool.enabled === false || tool.diagnostic) return false
  if (server.integrationId) return server.brokerEnabled === true
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

/** Allows protocol access only through an explicitly selected server or tool. */
export function isMcpServerSelected(
  agent: { tools?: string[] },
  server: McpServer,
) {
  if (!server.enabled) return false
  if (server.integrationId) return server.brokerEnabled === true
  if (server.brokerEnabled && agent.tools?.includes(mcpServerSelection(server)))
    return true
  return !!server.tools?.some((tool) => isMcpToolSelected(agent, server, tool))
}

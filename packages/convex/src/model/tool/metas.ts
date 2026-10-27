import {
  TOOL_CAPABILITIES,
  isReservedToolName,
} from '@sb/core/tool-capabilities'
import { mcpToolDescription, mcpToolName } from '@sb/core/types'
import { mcpServerSelection } from '@sb/core/types/mcp-catalog'

import type { AuthQueryCtx } from '../../functions'
import { minRole } from '../../lib/roles'
import { resolve as resolveMcpServers } from '../mcp'
import type { ToolMeta } from './context'
import { enabledMcpServers } from './settings'

/** These are what the user sees in the UI */
export const TOOL_METAS = TOOL_CAPABILITIES

export type ToolName = (typeof TOOL_METAS)[number]['name']

export async function listTools(ctx: AuthQueryCtx): Promise<ToolMeta[]> {
  const builtin: ToolMeta[] = minRole(ctx.role, 'admin')
    ? [...TOOL_METAS]
    : TOOL_METAS.filter((t) => !('requiresAdmin' in t && t.requiresAdmin))

  const servers = await resolveMcpServers(ctx, ctx.userId)
  const external: ToolMeta[] = []
  for (const server of enabledMcpServers(servers)) {
    if (server.transport === 'stdio' && !minRole(ctx.role, 'admin')) continue
    if (server.brokerEnabled) {
      external.push({
        name: mcpServerSelection(server),
        label: `${server.label} (MCP broker)`,
        description: `Search and call enabled tools from ${server.label}.`,
        category: 'mcp',
      })
    }
    for (const meta of server.tools ?? []) {
      if (meta.enabled === false || meta.diagnostic) continue
      if (isReservedToolName(mcpToolName(server, meta))) continue
      if (server.brokerEnabled) continue
      external.push({
        name: mcpToolName(server, meta),
        description: mcpToolDescription(meta),
        category: 'mcp',
      })
    }
  }

  return [...builtin, ...external]
}

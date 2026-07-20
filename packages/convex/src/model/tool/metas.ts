import { PLAN_TOOL_TOGGLE, TODO_TOOL_TOGGLE } from '@sb/core/const'
import { mcpToolDescription, mcpToolName } from '@sb/core/types'

import type { AuthQueryCtx } from '../../functions'
import { minRole } from '../../lib/roles'
import { getOrDefault as getSettings } from '../settings'
import type { ToolMeta } from './context'
import { enabledMcpServers } from './settings'

/** These are what the user sees in the UI */
export const TOOL_METAS = [
  {
    name: 'web_fetch',
    description:
      'Fetch a web page and return its main content as clean markdown.',
    category: 'web',
  },
  {
    name: 'web_search',
    description: 'Search the web through configured search engine instances.',
    category: 'web',
  },
  {
    name: 'read_file',
    description: 'Read files.',
    category: 'workspace',
    requiresAdmin: true,
    requiresWorkspace: true,
  },
  {
    name: 'write_file',
    description: 'Create or overwrite files.',
    category: 'workspace',
    requiresAdmin: true,
    requiresWorkspace: true,
  },
  {
    name: 'edit_file',
    description: 'Edit files.',
    category: 'workspace',
    requiresAdmin: true,
    requiresWorkspace: true,
  },
  {
    name: 'shell',
    description: 'Run shell commands using bash.',
    category: 'workspace',
    requiresAdmin: true,
    requiresWorkspace: true,
  },
  {
    name: TODO_TOOL_TOGGLE,
    description: 'Track multi-step work with a todo list.',
  },
  {
    name: PLAN_TOOL_TOGGLE,
    description: 'Research and author implementation plans before editing.',
    requiresAdmin: true,
  },
] as const

export type ToolName = (typeof TOOL_METAS)[number]['name']

export async function listTools(ctx: AuthQueryCtx): Promise<ToolMeta[]> {
  const builtin: ToolMeta[] = minRole(ctx.role, 'admin')
    ? [...TOOL_METAS]
    : TOOL_METAS.filter((t) => !('requiresAdmin' in t && t.requiresAdmin))

  const settings = await getSettings(ctx)
  const external: ToolMeta[] = []
  for (const server of enabledMcpServers(settings)) {
    for (const meta of server.tools ?? []) {
      external.push({
        name: mcpToolName(server, meta.name),
        description: mcpToolDescription(meta),
        category: 'mcp',
      })
    }
  }

  return [...builtin, ...external]
}

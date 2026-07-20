import { PLAN_TOOL_TOGGLE, TODO_TOOL_TOGGLE } from '@sb/core/const'
import { mcpToolDescription, mcpToolName } from '@sb/core/types'

import type { Doc } from '../../_generated/dataModel'
import { type Role, minRole } from '../../lib/roles'
import { TASK_TOOL_NAME } from '../../lib/subagent'
import type { SpawnableAgent } from '../agent/subagents'
import {
  type WebToolSettings,
  enabledMcpServers,
  normalizeWebSearchInstances,
} from './settings'

/**
 * The cached shape of a session's tool set: everything the provider actually
 * sees. Captured once and reused for the rest of the session. Deliberately
 * excludes anything behavioral.
 */
export type ToolManifest = {
  /** Exact tool names, in the order they are sent. */
  names: string[]
  /** Agent roster baked into the task tool description. */
  taskRoster?: string
  /** External MCP wire metadata, keyed by name. */
  mcp?: McpManifestEntry[]
}

export type McpManifestEntry = {
  /** Tool name (label slug + tool name). */
  name: string
  /** Settings row id, used to look the server up at call time. */
  serverId: string
  /** Tool name as the external server knows it. */
  toolName: string
  /** Tool description. */
  description?: string
  /** Serialized JSON Schema; Convex rejects `$`-prefixed object keys. */
  inputSchema?: string
}

type ManifestInput = {
  agent: Pick<Doc<'agents'>, 'tools'>
  invoker: Pick<Doc<'users'>, 'role'>
  session: Pick<Doc<'sessions'>, 'workspace' | 'parent'>
  settings: WebToolSettings
  spawnableAgents: SpawnableAgent[]
}

/** Builds the roster block appended to the task tool description. */
export function buildTaskRoster(spawnable: SpawnableAgent[]): string {
  return spawnable
    .map(
      (agent) =>
        `- ${agent.name}${agent.description ? `: ${agent.description}` : ''}`,
    )
    .join('\n')
}

/**
 * Resolves the tool set once from live state. Everything gated here is cached
 * from this point on, meaning a mid-session workspace bind, MCP toggle or agent
 * rename will not be reflected until the user resets the session cache.
 */
export function resolveToolManifest(data: ManifestInput): ToolManifest {
  const admin = minRole(data.invoker.role as Role | undefined, 'admin')
  const subagent = !!data.session.parent
  const selected = new Set(
    Array.isArray(data.agent.tools) ? (data.agent.tools as string[]) : [],
  )

  const workspaceTools =
    admin && data.session.workspace
      ? ['read_file', 'write_file', 'edit_file', 'shell']
      : []

  // Reserved up front so an external MCP tool can never shadow a built-in
  const builtins = ['web_fetch', 'web_search', ...workspaceTools]
  const reserved = new Set([...builtins, 'shell_output', 'kill_shell'])

  const names: string[] = []
  const mcp: McpManifestEntry[] = []
  const take = (name: string) => {
    if (selected.has(name)) names.push(name)
  }

  take('web_fetch')
  if (normalizeWebSearchInstances(data.settings?.webSearchInstances).length) {
    take('web_search')
  }

  const seenMcp = new Set<string>()
  for (const server of enabledMcpServers(data.settings)) {
    for (const meta of server.tools ?? []) {
      const name = mcpToolName(server, meta.name)
      // Built-ins and earlier servers win the name
      if (reserved.has(name) || seenMcp.has(name)) continue
      seenMcp.add(name)
      if (!selected.has(name)) continue

      names.push(name)
      mcp.push({
        name,
        serverId: server.id,
        toolName: meta.name,
        description: mcpToolDescription(meta),
        inputSchema: meta.inputSchema,
      })
    }
  }

  for (const name of workspaceTools) take(name)
  // Companions ride along with shell rather than being separately selectable
  if (names.includes('shell')) names.push('shell_output', 'kill_shell')

  if (admin && selected.has(PLAN_TOOL_TOGGLE)) {
    names.push('write_plan', 'edit_plan')
    if (!subagent) names.push('enter_plan_mode', 'exit_plan_mode')
  }

  if (selected.has(TODO_TOOL_TOGGLE)) {
    names.push('write_todo', 'edit_todo')
  }

  const roster = data.spawnableAgents.length
    ? buildTaskRoster(data.spawnableAgents)
    : undefined
  if (roster) names.push(TASK_TOOL_NAME)

  return {
    names,
    ...(roster && { taskRoster: roster }),
    ...(mcp.length && { mcp }),
  }
}

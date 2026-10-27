import {
  BUILTIN_TOOL_NAMES,
  FILESYSTEM_TOOL_NAMES,
  hasFilesystemTools,
} from './tool-capabilities'
import { MCP_BROKER_TOOLS } from './types/mcp-catalog'

export type ToolContextType = 'workspace' | 'skills' | 'mcp'
export const TOOL_CONTEXT_POLICY_VERSION = 7

/** Captures only the tools on which this automatic context depends. */
export function contextDependencies(
  type: ToolContextType,
  names: readonly string[],
) {
  if (type === 'workspace') {
    return names.filter((name) =>
      FILESYSTEM_TOOL_NAMES.includes(
        name as (typeof FILESYSTEM_TOOL_NAMES)[number],
      ),
    )
  }
  if (type === 'skills') {
    return names.filter((name) =>
      ['list_skills', 'read_skill', 'read_file'].includes(name),
    )
  }
  return names
    .filter(
      (name) =>
        !BUILTIN_TOOL_NAMES.includes(name) ||
        MCP_BROKER_TOOLS.includes(name as (typeof MCP_BROKER_TOOLS)[number]),
    )
    .sort()
}

export function contextEnabled(
  type: ToolContextType,
  names: readonly string[],
) {
  if (type === 'workspace') return hasFilesystemTools(names)
  if (type === 'skills') return names.includes('list_skills')
  return contextDependencies('mcp', names).some(
    (name) => name !== 'read_mcp_output',
  )
}

type AutomaticNote = {
  type?: string
  sender: { id: string }
  extra?: object
}

/** Filters automatic feature notes without changing stored history. */
export function canReplayToolContext(
  note: AutomaticNote,
  names: readonly string[],
  agentId: string,
  version = 1,
) {
  if (!['workspace', 'skills', 'mcp'].includes(note.type ?? '')) {
    return true
  }
  if (version < TOOL_CONTEXT_POLICY_VERSION) {
    return note.type !== 'mcp' || note.sender.id === agentId
  }
  if (note.sender.id !== agentId) {
    return false
  }

  const dependencies =
    note.extra && 'capabilities' in note.extra
      ? note.extra.capabilities
      : undefined

  if (!Array.isArray(dependencies) || !dependencies.length) return false
  if (note.type === 'workspace' && !hasFilesystemTools(names)) return false
  if (note.type === 'skills' && !names.includes('list_skills')) return false

  return dependencies.every(
    (name) => typeof name === 'string' && names.includes(name),
  )
}

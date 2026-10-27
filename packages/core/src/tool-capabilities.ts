/** One opt-in setting for each coherent built-in workflow. */
export const TOOL_CAPABILITIES = [
  {
    name: 'ask',
    label: 'Ask questions',
    description: 'Ask you for decisions when needed.',
    category: 'general',
    tools: ['ask'],
  },
  {
    name: 'read_attachment',
    label: 'Read attachments',
    description: 'Read attached files.',
    category: 'general',
    tools: ['read_attachment'],
  },
  {
    name: 'task',
    label: 'Delegate tasks',
    description: 'Delegate work to subagents.',
    category: 'general',
    tools: ['task'],
  },
  {
    name: 'web_fetch',
    label: 'Web fetch',
    description: 'Fetch a web page as readable text.',
    category: 'web',
    tools: ['web_fetch'],
  },
  {
    name: 'web_search',
    label: 'Web search',
    description: 'Search through your configured search engines.',
    category: 'web',
    tools: ['web_search'],
  },
  {
    name: 'read_file',
    label: 'Read files',
    description:
      'Read files in source directories and agent folders.',
    category: 'workspace',
    tools: ['read_file'],
    requiresAdmin: true,
    requiresWorkspace: true,
  },
  {
    name: 'edit_files',
    label: 'Edit files',
    description: 'Create, replace, and edit files.',
    category: 'workspace',
    tools: ['write_file', 'edit_file'],
    requiresAdmin: true,
    requiresWorkspace: true,
  },
  {
    name: 'shell',
    label: 'Shell',
    description: 'Run shell commands on the host machine.',
    category: 'workspace',
    tools: ['shell', 'shell_output', 'kill_shell'],
    requiresAdmin: true,
    requiresWorkspace: true,
  },
  {
    name: 'plan',
    label: 'Planning',
    description: 'Write plans and enter or leave plan mode.',
    category: 'planning',
    tools: ['write_plan', 'edit_plan', 'enter_plan_mode', 'exit_plan_mode'],
    requiresAdmin: true,
  },
  {
    name: 'todo',
    label: 'Todo list',
    description: 'Create and update a task list.',
    category: 'planning',
    tools: ['write_todo', 'edit_todo'],
  },
  {
    name: 'mcp_access',
    label: 'MCP access',
    description:
      'Discover and call MCP servers.',
    category: 'mcp-skills',
    tools: [
      'search_mcp_tools',
      'call_mcp_tool',
      'mcp_protocol',
      'read_mcp_output',
    ],
  },
  {
    name: 'skills',
    label: 'Skills',
    description:
      'Discover selected skills and read integration instructions.',
    category: 'mcp-skills',
    tools: ['list_skills', 'read_skill'],
    requiresAdmin: true,
  },
] as const

export type ToolCapability = (typeof TOOL_CAPABILITIES)[number]
export type BuiltinToolName = ToolCapability['tools'][number]

export const BUILTIN_TOOL_NAMES: readonly string[] = TOOL_CAPABILITIES.flatMap(
  (capability) => [...capability.tools],
)

const capabilityNames = new Set<string>(
  TOOL_CAPABILITIES.map((row) => row.name),
)
const reserved = new Set<string>([...BUILTIN_TOOL_NAMES, ...capabilityNames])

/** Protects both callable names and selection keys from external aliases. */
export function isReservedToolName(name: string) {
  return reserved.has(name)
}

/** Expands saved capability choices without granting missing prerequisites. */
export function selectedBuiltinTools(
  selection: readonly string[] = [],
): string[] {
  const selected = new Set(selection)
  return TOOL_CAPABILITIES.filter((row) => selected.has(row.name)).flatMap(
    (row) => [...row.tools],
  )
}

export const FILESYSTEM_TOOL_NAMES = [
  'read_file',
  'write_file',
  'edit_file',
  'shell',
  'shell_output',
  'kill_shell',
] as const

export function hasFilesystemTools(names: readonly string[]) {
  return FILESYSTEM_TOOL_NAMES.some((name) => names.includes(name))
}

/** Drops retired member selections while preserving independent external choices. */
export function normalizeToolSelection(names: readonly string[] = []) {
  return [...new Set(names)].filter(
    (name) => !isReservedToolName(name) || capabilityNames.has(name),
  )
}

/** Changes only the requested choices, retaining external selections absent from discovery. */
export function toggleToolSelection(
  selection: readonly string[],
  targets: readonly string[],
  available: readonly { name: string }[],
) {
  const selected = new Set(normalizeToolSelection(selection))
  const allOn = targets.every((name) => selected.has(name))
  for (const name of targets) {
    if (allOn) selected.delete(name)
    else selected.add(name)
  }
  const ordered = available
    .filter((row) => selected.has(row.name))
    .map((row) => row.name)
  const known = new Set(ordered)
  return [...ordered, ...[...selected].filter((name) => !known.has(name))]
}

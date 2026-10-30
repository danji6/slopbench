import type { BuiltinToolName } from '@sb/core/tool-capabilities'
import type { LucideIcon } from 'lucide-react'
import {
  BookOpenTextIcon,
  CircleHelpIcon,
  ClipboardListIcon,
  GlobeIcon,
  LibraryIcon,
  ListTodoIcon,
  NetworkIcon,
  PaperclipIcon,
  PencilIcon,
  PlugIcon,
  SquareTerminalIcon,
} from 'lucide-react'

const TOOL_ICONS: Record<BuiltinToolName, LucideIcon> = {
  write_file: PencilIcon,
  edit_file: PencilIcon,
  read_file: BookOpenTextIcon,
  read_attachment: PaperclipIcon,
  web_search: GlobeIcon,
  web_fetch: GlobeIcon,
  shell: SquareTerminalIcon,
  shell_output: SquareTerminalIcon,
  kill_shell: SquareTerminalIcon,
  task: NetworkIcon,
  write_plan: ClipboardListIcon,
  edit_plan: ClipboardListIcon,
  enter_plan_mode: ClipboardListIcon,
  exit_plan_mode: ClipboardListIcon,
  write_todo: ListTodoIcon,
  edit_todo: ListTodoIcon,
  ask: CircleHelpIcon,
  list_skills: LibraryIcon,
  read_skill: BookOpenTextIcon,
  search_mcp_tools: PlugIcon,
  call_mcp_tool: PlugIcon,
  mcp_protocol: PlugIcon,
  read_mcp_output: PlugIcon,
}

/** Renders a consistent decorative icon for a built-in tool. */
export function ToolIcon({ name }: { name: string }) {
  const icons: Partial<Record<string, LucideIcon>> = TOOL_ICONS
  const Icon = Object.hasOwn(icons, name) ? icons[name] : undefined
  if (!Icon) return null

  return (
    <Icon
      aria-hidden="true"
      className="text-muted-foreground size-3.5 shrink-0"
    />
  )
}

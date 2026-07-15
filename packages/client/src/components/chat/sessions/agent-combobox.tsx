import { Combobox } from '@/components/ui'
import type { Id } from '@sb/convex/_generated/dataModel'

import { SessionAvatar } from './session-avatar'

export type AgentItem = {
  id: Id<'agents'>
  name: string
  avatarId?: Id<'avatars'>
}

type AgentComboboxProps = {
  agents: AgentItem[]
  value?: string
  onValueChange: (value: string) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onOpenChangeComplete?: (open: boolean) => void
  /** The `Combobox.Trigger` element, rendered inside the combobox context. */
  trigger: React.ReactNode
  /** Optional content rendered at the top of the list, above the search field. */
  header?: React.ReactNode
  /** Render the search field once the list exceeds this length. */
  searchThreshold?: number
  /** Label to show when the agent list is empty. */
  emptyLabel?: string
}

export function AgentCombobox({
  agents,
  value,
  onValueChange,
  open,
  onOpenChange,
  onOpenChangeComplete,
  trigger,
  header,
  searchThreshold = 3,
  emptyLabel = 'No agents found.',
}: AgentComboboxProps) {
  return (
    <Combobox
      value={value}
      onValueChange={onValueChange}
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={onOpenChangeComplete}
    >
      {trigger}
      <Combobox.Content className="w-[calc(min(fit-content,100%,200px))]">
        {header}
        {agents.length > searchThreshold && <Combobox.Search />}
        <Combobox.List>
          <Combobox.Empty>{emptyLabel}</Combobox.Empty>
          <Combobox.Group>
            {agents.map((agent) => (
              <Combobox.Item key={agent.id} value={agent.id}>
                <AgentItemLabel agent={agent} />
              </Combobox.Item>
            ))}
          </Combobox.Group>
        </Combobox.List>
      </Combobox.Content>
    </Combobox>
  )
}

export function AgentItemLabel({
  agent,
  placeholder = 'Select agent...',
  ...props
}: {
  agent?: AgentItem
  placeholder?: string
} & React.ComponentProps<typeof SessionAvatar>) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {agent && (
        <SessionAvatar avatarId={agent.avatarId} {...props} noHover size="sm" />
      )}
      <span className="min-w-0 truncate">{agent?.name || placeholder}</span>
    </span>
  )
}

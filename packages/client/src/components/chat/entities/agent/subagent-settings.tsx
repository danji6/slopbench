import { SearchInput, SettingsList } from '@/components/ui'
import { useOwnedAgents } from '@/hooks/chat'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useState } from 'react'
import type { Control } from 'react-hook-form'
import { useController } from 'react-hook-form'

import { AgentItemLabel } from '../../sessions/agent-combobox'
import type { AgentFormValues } from './agent-form'
import { SubagentModelPopover } from './subagent-model-popover'

export function SubagentSettings({
  control,
}: {
  control: Control<AgentFormValues>
}) {
  const agents = useOwnedAgents() ?? []
  const [search, setSearch] = useState('')
  const [openAgentId, setOpenAgentId] = useState<Id<'agents'> | null>(null)
  const { field: modeField } = useController({ control, name: 'subAgentsMode' })
  const { field: idsField } = useController({ control, name: 'subAgentIds' })

  const whitelist = modeField.value === 'allow'
  const listed = new Set(idsField.value)
  const isSpawnable = (id: Id<'agents'>) => whitelist === listed.has(id)

  function toggle(id: Id<'agents'>) {
    idsField.onChange(
      listed.has(id)
        ? idsField.value.filter((entry) => entry !== id)
        : [...idsField.value, id],
    )
  }

  const query = search.trim().toLowerCase()
  const filteredAgents = agents.filter((agent) =>
    `${agent.name} ${agent.description ?? ''}`.toLowerCase().includes(query),
  )
  const spawnableCount = filteredAgents.filter((agent) =>
    isSpawnable(agent._id),
  ).length
  const allOn =
    filteredAgents.length > 0 && spawnableCount === filteredAgents.length

  function toggleAll() {
    const next = new Set(listed)
    const enable = !allOn
    for (const agent of filteredAgents) {
      if (whitelist === enable) next.add(agent._id)
      else next.delete(agent._id)
    }
    idsField.onChange([...next])
  }

  return (
    <SettingsList>
      <div className="px-4 py-3">
        <SearchInput
          aria-label="Search agents"
          clearLabel="Clear agent search"
          placeholder="Search agents…"
          value={search}
          onValueChange={setSearch}
        />
      </div>

      <SettingsList.Checkbox
        label={
          <span className="font-semibold">
            {query ? 'All matching agents' : 'All agents'}
          </span>
        }
        checked={allOn}
        indeterminate={spawnableCount > 0 && !allOn}
        disabled={filteredAgents.length === 0}
        onCheckedChange={toggleAll}
      />
      {filteredAgents.map((agent) => (
        <SettingsList.Checkbox
          key={agent._id}
          className="pl-8"
          label={
            <AgentItemLabel
              agent={{
                id: agent._id,
                name: agent.name,
                avatarId: agent.avatarId,
              }}
            />
          }
          description={
            agent.description && (
              <span className="line-clamp-1" title={agent.description}>
                {agent.description}
              </span>
            )
          }
          actions={
            <SubagentModelPopover
              control={control}
              agent={agent}
              open={openAgentId === agent._id}
              onOpenChange={(open) =>
                setOpenAgentId((current) =>
                  open ? agent._id : current === agent._id ? null : current,
                )
              }
            />
          }
          checked={isSpawnable(agent._id)}
          onCheckedChange={() => toggle(agent._id)}
        />
      ))}
      {query && filteredAgents.length === 0 && (
        <p className="text-muted-foreground px-4 py-3 text-sm" role="status">
          No agents match your search.
        </p>
      )}
    </SettingsList>
  )
}

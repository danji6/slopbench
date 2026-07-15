import { md } from '@/components/markdown'
import { SettingsList } from '@/components/ui'
import { useOwnedAgents } from '@/hooks/chat'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { Control } from 'react-hook-form'
import { useController } from 'react-hook-form'

import { AgentItemLabel } from '../../sessions/agent-combobox'
import type { AgentFormValues } from './agent-form'

export function SubagentSettings({
  control,
}: {
  control: Control<AgentFormValues>
}) {
  const agents = useOwnedAgents() ?? []
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

  function setMode(mode: string) {
    if (mode === modeField.value) return
    const inverted = agents
      .map((agent) => agent._id)
      .filter((id) => !listed.has(id))
    modeField.onChange(mode)
    idsField.onChange(inverted)
  }

  const spawnableCount = agents.filter((agent) => isSpawnable(agent._id)).length
  const allOn = agents.length > 0 && spawnableCount === agents.length

  function toggleAll() {
    idsField.onChange(
      (whitelist ? !allOn : allOn) ? agents.map((agent) => agent._id) : [],
    )
  }

  return (
    <SettingsList>
      <SettingsList.Select
        label="List mode"
        description="How the selection below treats agents you create later."
        help={md`
          **Whitelist**: only the checked agents can be spawned.
          **Blacklist**: every agent can be spawned unless unchecked.
        `}
        value={modeField.value}
        onValueChange={setMode}
      >
        <SettingsList.Select.Item value="allow">
          Whitelist
        </SettingsList.Select.Item>
        <SettingsList.Select.Item value="deny">
          Blacklist
        </SettingsList.Select.Item>
      </SettingsList.Select>

      <SettingsList.Checkbox
        label={<span className="font-semibold">All agents</span>}
        checked={allOn}
        indeterminate={spawnableCount > 0 && !allOn}
        onCheckedChange={toggleAll}
      />
      {agents.map((agent) => (
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
          checked={isSpawnable(agent._id)}
          onCheckedChange={() => toggle(agent._id)}
        />
      ))}
    </SettingsList>
  )
}

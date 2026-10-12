import { AgentFiles } from '@/components/chat/skills/agent-files'
import { AgentSkills } from '@/components/chat/skills/agent-skills'
import { Tabs } from '@/components/ui'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useState } from 'react'
import type { Control } from 'react-hook-form'

import type { AgentFormValues } from './agent-form'
import { BehaviorGeneralSettings } from './behavior-general-settings'

type BehaviorSettingsProps = {
  control: Control<AgentFormValues>
  agentId?: Id<'agents'>
}

export function BehaviorSettings({ control, agentId }: BehaviorSettingsProps) {
  const [tab, setTab] = useState('behavior')
  return (
    <Tabs variant="hug" value={tab} onValueChange={setTab}>
      <Tabs.List
        aria-label="Behavior settings"
        className="bg-background sticky top-0 z-20 shrink-0"
      >
        <Tabs.Trigger value="behavior">Behavior</Tabs.Trigger>
        <Tabs.Trigger value="skills">Skills</Tabs.Trigger>
        <Tabs.Trigger value="files">Files</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Panels>
        <Tabs.Content value="behavior">
          <BehaviorGeneralSettings control={control} />
        </Tabs.Content>
        <Tabs.Content value="skills">
          <AgentSkills agentId={agentId} />
        </Tabs.Content>
        <Tabs.Content value="files">
          <AgentFiles agentId={agentId} />
        </Tabs.Content>
      </Tabs.Panels>
    </Tabs>
  )
}

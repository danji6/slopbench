import { ResettablePromptList } from '@/components/chat/prompts'
import { md } from '@/components/markdown'
import { SettingsList } from '@/components/ui'
import { useSettings } from '@/hooks/chat'
import type { MathMode, ScrollMode } from '@/lib/chat'
import {
  createDefaultCompactionPrompts,
  createDefaultImpersonationPrompts,
} from '@sb/convex/model/defaults'
import type { Control, UseFormSetValue } from 'react-hook-form'
import { Controller } from 'react-hook-form'

import type { AgentFormValues } from './agent-form'
import { AgentPromptList } from './agent-prompt-list'
import { AgentReminderList } from './agent-reminder-list'
import { OverrideLabel, OverrideSection } from './override-section'

export function BehaviorSettings({
  control,
  setValue,
}: {
  control: Control<AgentFormValues>
  setValue: UseFormSetValue<AgentFormValues>
}) {
  const settings = useSettings()

  return (
    <SettingsList>
      <Controller
        control={control}
        name="scrollMode"
        render={({ field }) => (
          <SettingsList.Select
            unclickable
            unhoverable
            label={<OverrideLabel>Scroll mode</OverrideLabel>}
            value={field.value ?? ''}
            onValueChange={(v) => field.onChange((v as ScrollMode) || null)}
            placeholder="Default"
          >
            <SettingsList.Select.Item value="">
              Default
            </SettingsList.Select.Item>
            <SettingsList.Select.Item value="follow">
              Follow
            </SettingsList.Select.Item>
            <SettingsList.Select.Item value="into-view">
              Into View
            </SettingsList.Select.Item>
          </SettingsList.Select>
        )}
      />

      <Controller
        control={control}
        name="mathMode"
        render={({ field }) => (
          <SettingsList.Select
            unclickable
            unhoverable
            label={<OverrideLabel>Math rendering</OverrideLabel>}
            value={field.value ?? ''}
            onValueChange={(v) => field.onChange((v as MathMode) || null)}
            placeholder="Default"
          >
            <SettingsList.Select.Item value="">
              Default
            </SettingsList.Select.Item>
            <SettingsList.Select.Item value="off">Off</SettingsList.Select.Item>
            <SettingsList.Select.Item value="single">
              Single $…$
            </SettingsList.Select.Item>
            <SettingsList.Select.Item value="double">
              Double $$…$$
            </SettingsList.Select.Item>
          </SettingsList.Select>
        )}
      />

      <SettingsList.Item
        unclickable
        unhoverable
        orientation="vertical"
        label="Prompts"
        help={md`
          Prompts are instructions that guide the AI's behavior and responses.
          You can add, edit, and reorder prompts to customize how the AI
          interacts with you. Some prompts are static and non-editable. These
          are not prompts but **markers**, they mark specific places in the
          message history. Adding a prompt after a marker will make it appear
          after that point in the conversation. For example if you add a prompt
          after 'Message History', it will be appended after the last message in
          the history.

          Keep in mind that dynamic prompts may invalidate the
          prompt cache for any providers that support it and result in higher
          costs.
        `}
      >
        <AgentPromptList control={control} setValue={setValue} />
      </SettingsList.Item>

      <Controller
        control={control}
        name="globalPromptsEnabled"
        render={({ field }) => (
          <SettingsList.Switch
            label="Inject global prompts"
            checked={field.value}
            onCheckedChange={(v) => field.onChange(v)}
          />
        )}
      />

      <SettingsList.Item
        unclickable
        unhoverable
        orientation="vertical"
        label="Reminders"
        help={md`
          Reminders are injected into the conversation at intervals. Add
          reminders of this agent's own, or pull reusable ones from your
          reminder library. Library reminders are edited in your user settings.
        `}
      >
        <AgentReminderList control={control} />
      </SettingsList.Item>

      <OverrideSection
        control={control}
        name="compactionPrompts"
        label="Compaction prompts"
        seed={() =>
          settings?.compactionPrompts ?? createDefaultCompactionPrompts()
        }
      >
        {(value, onChange) => (
          <ResettablePromptList
            prompts={value}
            onChange={onChange}
            kind="compaction"
            createDefaults={createDefaultCompactionPrompts}
          />
        )}
      </OverrideSection>

      <OverrideSection
        control={control}
        name="impersonationPrompts"
        label="Impersonation prompts"
        seed={() =>
          settings?.impersonationPrompts ?? createDefaultImpersonationPrompts()
        }
      >
        {(value, onChange) => (
          <ResettablePromptList
            prompts={value}
            onChange={onChange}
            kind="impersonation"
            createDefaults={createDefaultImpersonationPrompts}
          />
        )}
      </OverrideSection>
    </SettingsList>
  )
}

import { ModelPicker } from '@/components/chat/models'
import {
  ReminderPromptList,
  ResettablePromptList,
} from '@/components/chat/prompts'
import { SettingsList } from '@/components/ui'
import {
  createDefaultCompactionPrompts,
  createDefaultImpersonationPrompts,
  createDefaultPlanPrompts,
} from '@sb/convex/model/defaults'
import type { Control } from 'react-hook-form'
import { Controller } from 'react-hook-form'

import { GlobalPromptList } from './global-prompt-list'
import { LibraryPromptList } from './library-prompt-list'
import type { SettingsFormValues } from './settings-schema'

type BehaviorSettingsProps = {
  control: Control<SettingsFormValues>
}

export function BehaviorSettings({ control }: BehaviorSettingsProps) {
  return (
    <SettingsList className="pb-4">
      <Controller
        control={control}
        name="scrollMode"
        render={({ field }) => (
          <SettingsList.Select
            unclickable
            unhoverable
            label="Scroll mode"
            description={
              field.value === 'follow'
                ? 'Auto scroll to follow the response as it streams in.'
                : 'Scroll the response into view to fill the viewport.'
            }
            value={field.value}
            onValueChange={(v) => field.onChange(v || 'follow')}
          >
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
            label="Math rendering"
            description={
              field.value === 'off'
                ? 'Math formulae are not rendered.'
                : field.value === 'double'
                  ? 'Only $$…$$ renders as math.'
                  : 'Both $…$ and $$…$$ render as math.'
            }
            value={field.value}
            onValueChange={field.onChange}
          >
            <SettingsList.Select.Item value="off">Off</SettingsList.Select.Item>
            <SettingsList.Select.Item value="single">
              Single ($…$)
            </SettingsList.Select.Item>
            <SettingsList.Select.Item value="double">
              Double ($$…$$)
            </SettingsList.Select.Item>
          </SettingsList.Select>
        )}
      />
      <Controller
        control={control}
        name="invertSend"
        render={({ field }) => (
          <SettingsList.Switch
            label="Send behavior"
            description={
              field.value
                ? 'Shift+Enter sends and Enter inserts a line break.'
                : 'Enter sends and Shift+Enter inserts a line break.'
            }
            checked={field.value}
            onCheckedChange={field.onChange}
          />
        )}
      />
      <Controller
        control={control}
        name="autoTitle"
        render={({ field }) => (
          <SettingsList.Switch
            label="Title generation"
            description="Automatically generate a title for new sessions."
            checked={field.value}
            onCheckedChange={field.onChange}
          />
        )}
      />
      <Controller
        control={control}
        name="titleModel"
        render={({ field }) => (
          <SettingsList.Item
            label="Title model"
            description="Model used to generate session titles."
            unclickable
            unhoverable
          >
            <ModelPicker
              variant="input"
              value={field.value ?? ''}
              onValueChange={(v) => field.onChange(v || null)}
            />
          </SettingsList.Item>
        )}
      />
      <SettingsList.Item
        unclickable
        unhoverable
        orientation="vertical"
        label="Prompt library"
        description="A library of prompts that can be reused across agents."
      >
        <Controller
          control={control}
          name="libraryPrompts"
          render={({ field }) => (
            <LibraryPromptList
              prompts={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </SettingsList.Item>
      <SettingsList.Item
        unclickable
        unhoverable
        orientation="vertical"
        label="Reminder library"
        description="A library of reminders that can be reused across agents."
      >
        <Controller
          control={control}
          name="libraryReminders"
          render={({ field }) => (
            <ReminderPromptList
              reminders={field.value}
              onChange={field.onChange}
              showEnabledSwitch={false}
            />
          )}
        />
      </SettingsList.Item>
      <SettingsList.Item
        unclickable
        unhoverable
        orientation="vertical"
        label="Global prompts"
        description="Prompts included in agents that have global prompts enabled."
      >
        <Controller
          control={control}
          name="globalPrompts"
          render={({ field }) => (
            <GlobalPromptList prompts={field.value} onChange={field.onChange} />
          )}
        />
      </SettingsList.Item>
      <SettingsList.Item
        unclickable
        unhoverable
        orientation="vertical"
        label="Compaction prompts"
        description="Prompts used when compacting conversation history."
      >
        <Controller
          control={control}
          name="compactionPrompts"
          render={({ field }) => (
            <ResettablePromptList
              prompts={field.value}
              onChange={field.onChange}
              kind="compaction"
              createDefaults={createDefaultCompactionPrompts}
            />
          )}
        />
      </SettingsList.Item>
      <SettingsList.Item
        unclickable
        unhoverable
        orientation="vertical"
        label="Impersonation prompts"
        description="Prompts used when the agent sends a message on your behalf."
      >
        <Controller
          control={control}
          name="impersonationPrompts"
          render={({ field }) => (
            <ResettablePromptList
              prompts={field.value}
              onChange={field.onChange}
              kind="impersonation"
              createDefaults={createDefaultImpersonationPrompts}
            />
          )}
        />
      </SettingsList.Item>
      <SettingsList.Item
        unclickable
        unhoverable
        orientation="vertical"
        label="Planning prompts"
        description="Prompts used while the agent is in plan mode."
      >
        <Controller
          control={control}
          name="planPrompts"
          render={({ field }) => (
            <ResettablePromptList
              prompts={field.value}
              onChange={field.onChange}
              kind="planning"
              createDefaults={createDefaultPlanPrompts}
            />
          )}
        />
      </SettingsList.Item>
    </SettingsList>
  )
}

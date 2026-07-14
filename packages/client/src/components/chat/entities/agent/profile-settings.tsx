import { AvatarPicker } from '@/components/chat/entities/avatar-picker'
import { Input, Label, SettingsList } from '@/components/ui'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { Control } from 'react-hook-form'
import { Controller } from 'react-hook-form'

import type { AgentFormValues } from './agent-form'

type ProfileSettingsProps = {
  control: Control<AgentFormValues>
  avatarId?: Id<'avatars'>
  pendingAvatar: File | null
  avatarCleared: boolean
  onStageAvatar: (file: File | null) => void
  onClearAvatar: () => void
}

export function ProfileSettings({
  control,
  avatarId,
  pendingAvatar,
  avatarCleared,
  onStageAvatar,
  onClearAvatar,
}: ProfileSettingsProps) {
  return (
    <SettingsList>
      <SettingsList.Item
        unclickable
        unhoverable
        contentClassName="flex-row items-center gap-4"
      >
        <AvatarPicker
          avatarId={avatarId}
          pendingAvatar={pendingAvatar}
          avatarCleared={avatarCleared}
          onStageAvatar={onStageAvatar}
          onClearAvatar={onClearAvatar}
        />

        <div className="flex flex-1 flex-col gap-1.5">
          <Label variant="settings">Name</Label>
          <Controller
            control={control}
            name="name"
            render={({ field }) => (
              <Input
                value={field.value}
                onChange={(e) => field.onChange(e.currentTarget.value)}
                onBlur={field.onBlur}
                placeholder="Identity name"
                variant="outline"
                className="h-10 max-w-70 text-sm"
              />
            )}
          />
        </div>
      </SettingsList.Item>

      <Controller
        control={control}
        name="description"
        render={({ field }) => (
          <SettingsList.Textarea
            label="Description"
            description="What this agent is for. Shown to other agents that can delegate tasks to it."
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            placeholder="Explores the codebase and reports findings."
            rows={3}
          />
        )}
      />
    </SettingsList>
  )
}

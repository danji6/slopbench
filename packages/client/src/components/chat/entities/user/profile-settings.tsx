import { AvatarPicker } from '@/components/chat/entities/avatar-picker'
import { Input, Label, SettingsList } from '@/components/ui'
import type { Id } from '@sb/convex/_generated/dataModel'
import { type Control, Controller } from 'react-hook-form'

import type { SettingsFormValues } from './settings-schema'

type ProfileSettingsProps = {
  control: Control<SettingsFormValues>
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
    <SettingsList className="pb-4">
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
            name="displayName"
            render={({ field }) => (
              <Input
                value={field.value}
                onChange={(e) => field.onChange(e.currentTarget.value)}
                onBlur={field.onBlur}
                placeholder="Your name"
                variant="outline"
                className="h-10 max-w-70 text-sm"
              />
            )}
          />
        </div>
      </SettingsList.Item>
    </SettingsList>
  )
}

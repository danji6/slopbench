import { SettingsList } from '@/components/ui'
import { useActiveSession } from '@/hooks/chat'
import { useUpdateSessionSettings } from '@/hooks/chat/sharing'

export function SessionSettingsSection() {
  const session = useActiveSession()
  const update = useUpdateSessionSettings()
  const settings = session?.settings

  return (
    <SettingsList>
      <SettingsList.NumberInput
        label="Slow mode"
        description="Seconds a user has to wait between sends."
        value={settings?.slowModeSeconds ?? 0}
        defaultValue={0}
        minValue={0}
        maxValue={3600}
        step={1}
        onChange={(slowModeSeconds) => void update({ slowModeSeconds })}
      />
      <SettingsList.NumberInput
        label="Agent delay"
        description="Seconds before an agent responds."
        value={settings?.agentDebounceSeconds ?? 0}
        defaultValue={0}
        minValue={0}
        maxValue={120}
        step={1}
        onChange={(agentDebounceSeconds) =>
          void update({ agentDebounceSeconds })
        }
      />
      <SettingsList.Switch
        label="Passive Send"
        description="User messages don't invoke the agent by default."
        checked={settings?.passiveSend ?? false}
        onCheckedChange={(passiveSend) => void update({ passiveSend })}
      />
    </SettingsList>
  )
}

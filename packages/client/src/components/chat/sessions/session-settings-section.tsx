import { SettingsList } from '@/components/ui'
import { useActiveSession } from '@/hooks/chat'
import { useUpdateSessionSettings } from '@/hooks/chat/sharing'

const toSeconds = (ms: number | undefined) => (ms ?? 0) / 1000

export function SessionSettingsSection() {
  const session = useActiveSession()
  const update = useUpdateSessionSettings()
  const settings = session?.settings

  return (
    <SettingsList>
      <SettingsList.NumberInput
        label="Slow mode"
        description="Seconds a user has to wait between sends."
        value={toSeconds(settings?.slowModeMs)}
        defaultValue={0}
        minValue={0}
        maxValue={3600}
        step={1}
        onChange={(seconds) => void update({ slowModeMs: seconds * 1000 })}
      />
      <SettingsList.NumberInput
        label="Agent delay"
        description="Seconds before an agent responds."
        value={toSeconds(settings?.agentDebounceMs)}
        defaultValue={0}
        minValue={0}
        maxValue={120}
        step={1}
        onChange={(seconds) => void update({ agentDebounceMs: seconds * 1000 })}
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

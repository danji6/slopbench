import { SettingsList } from '@/components/ui'
import { useActiveSession } from '@/hooks/chat'
import { useSetDisabled } from '@/hooks/chat/sharing'

export function SessionLockSection() {
  const session = useActiveSession()
  const setDisabled = useSetDisabled()

  return (
    <SettingsList>
      <SettingsList.Switch
        label="Locked"
        description="Stops streams and blocks new activity."
        checked={session?.settings?.disabled ?? false}
        onCheckedChange={(checked) => void setDisabled(checked)}
      />
    </SettingsList>
  )
}

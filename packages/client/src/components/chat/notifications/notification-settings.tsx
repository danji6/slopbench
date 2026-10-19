import { Popover, RippleButton, Switch } from '@/components/ui'
import { SettingsIcon } from 'lucide-react'

import { useNotifications } from './notification-provider'

/** Edits desktop delivery without changing the browser's permission setting. */
export function NotificationSettings() {
  const {
    desktopEnabled,
    desktopSaving,
    desktopPermission,
    setDesktopEnabled,
  } = useNotifications()

  const blocked =
    desktopPermission === 'denied' || desktopPermission === 'unsupported'

  return (
    <Popover>
      <Popover.Trigger
        render={
          <RippleButton
            variant="stealth"
            size="icon-sm"
            aria-label="Notification settings"
          />
        }
      >
        <SettingsIcon />
      </Popover.Trigger>
      <Popover.Content side="top" align="end" className="w-80 p-3">
        <Popover.Title className="text-sm">Notification settings</Popover.Title>
        <Switch
          className="w-full"
          size="xs"
          checked={desktopEnabled}
          disabled={desktopSaving || blocked}
          onCheckedChange={(value) => void setDesktopEnabled(value)}
        >
          Enable desktop notifications
        </Switch>
        {blocked && (
          <p className="text-muted-foreground text-xs">
            {desktopPermission === 'denied'
              ? 'Desktop notifications are blocked in browser settings.'
              : 'Desktop notifications are not supported in this browser context.'}
          </p>
        )}
      </Popover.Content>
    </Popover>
  )
}

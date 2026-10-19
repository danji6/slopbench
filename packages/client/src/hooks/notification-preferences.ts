import {
  registerNotificationWorker,
  supportsDesktopNotifications,
} from '@/lib/notification-desktop'
import { toastError } from '@/lib/notifications'
import { api } from '@sb/convex/_generated/api'
import { useMutation, useQuery } from 'convex/react'
import { useCallback, useEffect, useState } from 'react'

export type DesktopPermission = NotificationPermission | 'unsupported'

/** Separates the user's delivery preference from the browser's permission. */
export function useNotificationPreferences() {
  const settings = useQuery(api.settings.get, {})

  const update = useMutation(api.settings.update).withOptimisticUpdate(
    (store, { patch }) => {
      const settings = store.getQuery(api.settings.get, {})
      if (settings)
        store.setQuery(api.settings.get, {}, { ...settings, ...patch })
    },
  )

  const [permission, setPermission] = useState<DesktopPermission>(readPermission) // prettier-ignore
  const [saving, setSaving] = useState(false)
  const enabled = settings?.desktopNotifications ?? false

  useEffect(() => {
    const refresh = () => setPermission(readPermission())
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  const setEnabled = useCallback(
    async (value: boolean) => {
      setSaving(true)
      try {
        if (value) {
          if (!supportsDesktopNotifications()) return
          const next = await Notification.requestPermission()
          setPermission(next)
          if (next !== 'granted') return
          await registerNotificationWorker()
        }
        await update({ patch: { desktopNotifications: value } })
      } catch (error) {
        toastError(error)
      } finally {
        setSaving(false)
      }
    },
    [update],
  )

  return {
    desktopReady: settings !== undefined,
    desktopPermission: permission,
    desktopEnabled: enabled && permission === 'granted',
    desktopSaving: saving,
    setDesktopEnabled: setEnabled,
  }
}

function readPermission(): DesktopPermission {
  return supportsDesktopNotifications()
    ? Notification.permission
    : 'unsupported'
}

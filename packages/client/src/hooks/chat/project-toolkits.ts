import { extractErrorMessage } from '@/lib/errors'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useAction } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { useState } from 'react'

import { useIsAdmin } from './tools'

type DiscoveredToolkits = FunctionReturnType<
  typeof api.actions.toolkits.discover
>

/** Coordinates explicit discovery and registration without changing activation. */
export function useProjectToolkits(sessionId: Id<'sessions'>) {
  const admin = useIsAdmin()
  const discover = useAction(api.actions.toolkits.discover)
  const link = useAction(api.actions.toolkits.link)
  const [rows, setRows] = useState<DiscoveredToolkits>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function scan() {
    setBusy(true)
    try {
      setRows(await discover({ sessionId }))
      setMessage('Discovery completed. No toolkit processes were started.')
    } catch (cause) {
      setMessage(extractErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function register(root: string) {
    setBusy(true)
    try {
      await link({ root })
      setMessage(
        'Linked disabled. Enable and review it in Settings → Toolkits.',
      )
    } catch (cause) {
      setMessage(extractErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return { admin, rows, busy, message, scan, register }
}

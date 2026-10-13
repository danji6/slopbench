import { extractErrorMessage } from '@/lib/errors'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useAction } from 'convex/react'
import { useEffect, useState } from 'react'

type Availability = { key: string; exists?: boolean; error?: string }

/** Refreshes disk availability on mount, focus, completion and while settings stay open. */
export function useAgentHomeStatus(
  agentId: Id<'agents'>,
  path: string | undefined,
  revision: number | undefined,
  busy: boolean,
) {
  const inspect = useAction(api.actions.skills.homeStatus)
  const key = `${agentId}:${path}`
  const [state, setState] = useState<Availability>()

  useEffect(() => {
    if (!path || busy) return
    let active = true
    let checking = false

    async function refresh() {
      if (checking) return
      checking = true
      try {
        const result = await inspect({ agentId })
        if (active) setState({ key, exists: result.exists })
      } catch (error) {
        if (active) setState({ key, error: extractErrorMessage(error) })
      } finally {
        checking = false
      }
    }

    void refresh()
    const timer = window.setInterval(() => void refresh(), 10_000)
    window.addEventListener('focus', refresh)

    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [agentId, path, revision, key, busy, inspect])

  return state?.key === key ? state : undefined
}

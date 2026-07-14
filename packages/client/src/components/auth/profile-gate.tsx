import { useMutation } from 'convex/react'
import { useEffect, useState } from 'react'
import { api } from '@sb/convex/_generated/api'

/**
 * Ensures the authenticated user's Convex `users` row exists before any
 * `authQuery` runs. Queries throw `Profile not initialized` (409) when the row
 * is missing; only a mutation creates it lazily, so we run `ensureProfile` once
 * on mount and render children only after it resolves.
 */
export function ProfileGate({ children }: { children: React.ReactNode }) {
  const ensureProfile = useMutation(api.users.ensureProfile)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true
    ensureProfile()
      .then(() => active && setReady(true))
      .catch(console.error)
    return () => {
      active = false
    }
  }, [ensureProfile])

  if (!ready) return null
  return <>{children}</>
}

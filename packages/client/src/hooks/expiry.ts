import { useEffect, useState } from 'react'

/**
 * True if `until` has passed. Re-renders once when the condition changes. */
export function useHasElapsed(until: number | null | undefined): boolean {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!until) return
    const remaining = Math.max(0, until - Date.now())
    const timeout = setTimeout(() => setNow(Date.now()), remaining)
    return () => clearTimeout(timeout)
  }, [until])

  return !until || until <= now
}

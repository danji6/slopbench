import { useEffect, useState } from 'react'

/**
 * Milliseconds remaining until `until`, re-rendering a few times a second while
 * active. Returns 0 when `until` is unset or already elapsed.
 */
export function useCountdown(until: number | null | undefined): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!until) return
    const interval = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(interval)
  }, [until])

  return until ? Math.max(0, until - now) : 0
}

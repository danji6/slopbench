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
    const timeout = setTimeout(
      () => {
        clearInterval(interval)
        setNow(Date.now())
      },
      Math.max(0, until - Date.now()),
    )
    return () => {
      clearInterval(interval)
      clearTimeout(timeout)
    }
  }, [until])

  return until ? Math.max(0, until - now) : 0
}

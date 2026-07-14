
import { useEffect, useState } from 'react'

export function useTimer(run: boolean, intervalMs = 100): number {
  const [elapsed, setElapsed] = useState(0)
  const [startTime] = useState(() => (run ? Date.now() : 0))

  useEffect(() => {
    if (!run) return
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime)
    }, intervalMs)
    return () => clearInterval(interval)
  }, [run, startTime, intervalMs])

  return elapsed
}

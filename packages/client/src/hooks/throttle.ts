import { useCallback, useRef, useState } from 'react'

export function useThrottledState<T>(
  initialValue: T,
  defaultDelay = 300,
): [T, (value: T, delay?: number) => void] {
  const [value, setValue] = useState<T>(initialValue)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastTimeRef = useRef<number>(0)

  const setThrottledValue = useCallback(
    (newValue: T, delay = defaultDelay) => {
      const now = Date.now()
      const lastTime = now - lastTimeRef.current

      if (delay <= 0) {
        setValue(newValue)
        lastTimeRef.current = now
        return
      }

      if (lastTime >= delay) {
        setValue(newValue)
        lastTimeRef.current = now
      } else {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }

        timeoutRef.current = setTimeout(() => {
          setValue(newValue)
          lastTimeRef.current = Date.now()
        }, delay - lastTime)
      }
    },
    [defaultDelay],
  )

  return [value, setThrottledValue] as const
}

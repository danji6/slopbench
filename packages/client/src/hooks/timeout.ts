
import { useRef, useState } from 'react'

export function useTimeoutState<T>(resetValue: T, defaultDelay: number) {
  const [value, setValue] = useState(resetValue)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  function set(
    newValue: T,
    changeCallback?: (value: T) => void,
    resetDelay: number = defaultDelay,
  ) {
    setValue(newValue)
    changeCallback?.(newValue)
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = setTimeout(() => {
      setValue(resetValue)
      changeCallback?.(resetValue)
    }, resetDelay)
  }

  return [value, set] as const
}

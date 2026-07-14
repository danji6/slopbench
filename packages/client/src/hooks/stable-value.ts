import { useState } from 'react'

export function useStableValue<T>(value: T, preservePrevious: boolean): T {
  const [stableValue, setStableValue] = useState(value)

  if (!preservePrevious && stableValue !== value) {
    setStableValue(value)
  }

  return preservePrevious ? stableValue : value
}

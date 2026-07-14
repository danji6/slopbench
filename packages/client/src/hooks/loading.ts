
import { useCallback, useState } from 'react'

export function useLoadingState(initialValue = false) {
  const [isLoading, setLoading] = useState(initialValue)

  const loadWhile = useCallback(async <T>(fn: () => Promise<T>) => {
    setLoading(true)
    try {
      return await fn()
    } finally {
      setLoading(false)
    }
  }, [])

  return [isLoading, loadWhile] as const
}

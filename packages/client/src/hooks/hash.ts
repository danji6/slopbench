import { isServer } from '@/lib/utils'
import { useCallback, useEffect, useState } from 'react'

export function useHash() {
  const [hash, setHash] = useState<string>('')

  const setHashValue = useCallback((value: string) => {
    if (isServer) return
    window.history.pushState(null, '', `#${encodeURIComponent(value)}`)
    setHash(value)
  }, [])

  useEffect(() => {
    if (isServer) return

    const handleHashChange = () => {
      setHash(decodeURIComponent(window.location.hash.slice(1)))
    }

    handleHashChange()

    window.addEventListener('hashchange', handleHashChange)
    window.addEventListener('popstate', handleHashChange)

    return () => {
      window.removeEventListener('hashchange', handleHashChange)
      window.removeEventListener('popstate', handleHashChange)
    }
  }, [])

  return [hash, setHashValue] as const
}

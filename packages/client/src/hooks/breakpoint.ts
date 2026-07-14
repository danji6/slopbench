import { isServer } from '@/lib/utils'
import { useEffect, useState } from 'react'

export type Breakpoint = 'sm' | 'md' | 'lg' | 'xl' | '2xl'

const breakpoints: Record<Breakpoint, number> = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
}

const query = (bp: Breakpoint) => `(max-width: ${breakpoints[bp] - 1}px)`

export function useBreakpoint(bp: Breakpoint) {
  const [match, setMatch] = useState(
    () => !isServer && window.matchMedia(query(bp)).matches,
  )

  useEffect(() => {
    if (isServer) return

    const m = window.matchMedia(query(bp))

    function handleChange() {
      setMatch(m.matches)
    }

    handleChange()

    m.addEventListener('change', handleChange)

    return () => {
      m.removeEventListener('change', handleChange)
    }
  }, [bp])

  return match
}

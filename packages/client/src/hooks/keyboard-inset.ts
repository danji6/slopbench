import { useEffect, useState } from 'react'

/**
 * Height of the layout viewport hidden behind the virtual keyboard. Stays 0
 * when the browser scrolls the visual viewport itself, which it does for
 * user-initiated focus but not for programmatic focus.
 */
export function useKeyboardInset() {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}

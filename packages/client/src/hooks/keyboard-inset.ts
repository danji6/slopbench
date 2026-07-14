import { useEffect, useState } from 'react'

export function useKeyboardInset(extraMargin = 0) {
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

  return inset + extraMargin
}

import { useEffect, useState } from 'react'

/** Delays showing `visible` by `delay` ms, hiding immediately when it clears. */
export function useDelayedVisibility(visible: boolean, delay: number) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => setIsVisible(visible),
      visible ? delay : 0,
    )
    return () => window.clearTimeout(timeoutId)
  }, [delay, visible])

  return isVisible
}

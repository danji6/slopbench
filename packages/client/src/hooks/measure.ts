import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Tracks an element's border-box height, starting from a synchronous read
 * before the first paint. Hidden elements report 0.
 */
export function useElementHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [height, setHeight] = useState(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setHeight(el.getBoundingClientRect().height)
    const observer = new ResizeObserver(([entry]) => {
      setHeight(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return [ref, height] as const
}

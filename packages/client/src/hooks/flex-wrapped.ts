import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Tracks whether a flex container has wrapped onto more than one row.
 *
 * @returns An array containing a ref to attach to the container, and
 * the current wrapped state.
 */
export function useFlexWrapped<T extends HTMLElement = HTMLElement>() {
  const ref = useRef<T>(null)
  const [wrapped, setWrapped] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const update = () => {
      const first = el.firstElementChild as HTMLElement | null
      const last = el.lastElementChild as HTMLElement | null
      setWrapped(!!first && !!last && last.offsetTop > first.offsetTop)
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)

    return () => observer.disconnect()
  }, [])

  return [ref, wrapped] as const
}

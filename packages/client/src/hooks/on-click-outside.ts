
import { type RefObject, useEffect } from 'react'

/**
 * Hook that alerts clicks outside of the passed ref
 */
export function useOnClickOutside<T extends HTMLElement = HTMLElement>(
  ref: RefObject<T | null>,
  handler: (event: MouseEvent | TouchEvent) => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return

    const listener = (event: MouseEvent | TouchEvent) => {
      const el = ref?.current
      if (!el || el.contains(event.target as Node)) {
        return
      }

      handler(event)
    }

    document.addEventListener('mousedown', listener)
    document.addEventListener('touchstart', listener)

    return () => {
      document.removeEventListener('mousedown', listener)
      document.removeEventListener('touchstart', listener)
    }
  }, [ref, handler, enabled])
}

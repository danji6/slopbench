import { animate } from 'motion'
import { useCallback, useEffect, useRef } from 'react'

/** Slowly reveals overflowing text on hover and eases to a stop at its end. */
export function useHoverScroll(text: string) {
  const ref = useRef<HTMLSpanElement>(null)
  const animation = useRef<ReturnType<typeof animate> | null>(null)
  const hovering = useRef(false)

  const reset = useCallback(() => {
    animation.current?.stop()
    animation.current = null
    if (!ref.current) return
    ref.current.scrollLeft = 0
    ref.current.style.textOverflow = ''
  }, [])

  const start = useCallback(() => {
    hovering.current = true
    reset()
    const element = ref.current
    if (!element || matchMedia('(prefers-reduced-motion: reduce)').matches)
      return
    const distance = element.scrollWidth - element.clientWidth
    if (distance <= 0) return

    element.style.textOverflow = 'clip'
    animation.current = animate(0, distance, {
      duration: Math.max(2, distance / 30),
      ease: [0.2, 0, 0.4, 1],
      onUpdate: (value) => {
        element.scrollLeft = value
      },
    })
  }, [reset])

  const stop = useCallback(() => {
    hovering.current = false
    reset()
  }, [reset])

  useEffect(() => {
    const element = ref.current
    if (!element) return
    reset()
    const observer = new ResizeObserver(() => {
      if (hovering.current) start()
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      reset()
    }
  }, [text, reset, start])

  return { ref, start, stop }
}

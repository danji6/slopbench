
import { type RippleOptions, useRipples } from '@/hooks'
import { useEffect, useRef, useState } from 'react'

/**
 * A convenience component that adds ripple effects within a parent component.
 * It automatically adds `relative` and `isolate` to the parent.
 * Make sure it's a direct child of the target component so the roundness is
 * inherited from it.
 */
export function Ripples(options: RippleOptions) {
  const ref = useRef<HTMLSpanElement>(null)
  const [parent, setParent] = useState<HTMLElement | null>(null)
  const ripples = useRipples(parent, options)

  useEffect(() => {
    if (!ref.current) return

    const parentElement = ref.current.parentElement

    if (parentElement) {
      parentElement.style.position = 'relative'
      parentElement.style.isolation = 'isolate'
      setParent(parentElement)
    }
  }, [])

  return (
    <span
      ref={ref}
      data-slot="ripples"
      className="absolute inset-0 overflow-hidden rounded-[inherit]"
    >
      {ripples}
    </span>
  )
}

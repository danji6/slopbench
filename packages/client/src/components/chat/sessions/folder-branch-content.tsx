import { useReducedMotion } from 'motion/react'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

type FolderBranchContentProps = {
  open: boolean
  disabled: boolean
  ready: boolean
  children: ReactNode
}

/** Retains a closing branch and animates asynchronous changes to its intrinsic size. */
export function FolderBranchContent({
  open,
  disabled,
  ready,
  children,
}: FolderBranchContentProps) {
  const [retained, setRetained] = useState(open)
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const animation = useRef<Animation | null>(null)
  const height = useRef(0)
  const initial = useRef(open)
  const reducedMotion = useReducedMotion()
  if (open && !retained) setRetained(true)

  useLayoutEffect(() => {
    if (!open) initial.current = false
    if (!ready || !initial.current) return
    // Initial sidebar population needs no motion, later user actions do
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        initial.current = false
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, ready])

  useLayoutEffect(() => {
    const element = outer.current
    const content = inner.current
    if (!element || !content) return

    function resize(next: number) {
      const from = animation.current
        ? element!.getBoundingClientRect().height
        : height.current
      if (next === height.current && !animation.current) return

      animation.current?.cancel()
      animation.current = null
      height.current = next
      element!.style.height = `${next}px`
      element!.style.overflow = 'hidden'

      const finish = () => {
        animation.current = null
        if (open) {
          element!.style.removeProperty('height')
          element!.style.removeProperty('overflow')
        } else setRetained(false)
      }

      if (
        initial.current ||
        reducedMotion ||
        disabled ||
        from === next ||
        !element!.animate
      ) {
        return finish()
      }

      const current = element!.animate(
        [{ height: `${from}px` }, { height: `${next}px` }],
        { duration: 200, easing: 'ease-out' },
      )

      animation.current = current
      current.onfinish = finish
    }

    resize(open ? content.getBoundingClientRect().height : 0)

    if (!open) {
      if (!height.current && !animation.current) setRetained(false)
      return
    }

    const observer = new ResizeObserver(() => {
      const next = content.getBoundingClientRect().height
      if (next !== height.current) resize(next)
    })
    observer.observe(content)

    return () => observer.disconnect()
  }, [open, retained, reducedMotion, disabled])

  useLayoutEffect(() => () => animation.current?.cancel(), [])

  return (
    <div
      ref={outer}
      data-slot="collapsible-content"
      inert={!open}
      aria-hidden={!open || undefined}
    >
      <div ref={inner}>{open || retained ? children : null}</div>
    </div>
  )
}

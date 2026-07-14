import type { ButtonProps, ButtonVariant } from '@/components/ui/button'
import { motion } from 'framer-motion'
import * as React from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

const RIPPLE_PADDING = 0

interface Ripple {
  id: string
  x: number
  y: number
  radius: number
  shouldFade: boolean
}

export type RippleOptions = {
  variant?: ButtonProps['variant']
  rippleVariant?: ButtonProps['variant']
  rippleDuration?: number
  fadeDuration?: number
  zIndex?: number
}

/**
 * Adds a ripple effect to an element. Note that you need to either
 * `isolate` the parent or raise the zIndex to avoid ripples being rendered
 * behind other elements. Also don't forget `overflow-hidden` and `relative`
 * on the parent or the ripples will leak out.
 * @returns The ripples to render that you can then put inside the parent component.
 */
export function useRipples(
  target: React.RefObject<HTMLElement | null> | HTMLElement | null,
  {
    variant,
    rippleVariant,
    rippleDuration = 350,
    fadeDuration = 500,
    zIndex = -1,
  }: RippleOptions = {},
) {
  const [isHovered, setHovered] = useState(false)
  const [ripples, setRipples] = useState<Ripple[]>([])
  const rippleId = useId()
  const rippleCountRef = useRef(0)
  const activeRipplesRef = useRef<Map<number, string>>(new Map())

  const color = useMemo(
    () => backgroundFor(rippleVariant || variant, isHovered),
    [variant, rippleVariant, isHovered],
  )

  const handlePointerEnter = useCallback((event: PointerEvent) => {
    if (event.pointerType === 'mouse') {
      setHovered(true)
    }
  }, [])

  const handlePointerUp = useCallback(
    (event: PointerEvent) => {
      const rippleId = activeRipplesRef.current.get(event.pointerId)
      if (rippleId === undefined) {
        return
      }

      activeRipplesRef.current.delete(event.pointerId)

      setRipples((prev) =>
        prev.map((r) => (r.id === rippleId ? { ...r, shouldFade: true } : r)),
      )

      setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.id !== rippleId))
      }, fadeDuration)
    },
    [fadeDuration],
  )

  const handlePointerLeave = useCallback(
    (event: PointerEvent) => {
      setHovered(false)
      handlePointerUp(event)
    },
    [handlePointerUp],
  )

  const handlePointerDown = useCallback(
    (event: PointerEvent) => {
      const clientX = event.clientX
      const clientY = event.clientY

      const element = event.currentTarget as HTMLElement
      if (!element) return

      const rect = element.getBoundingClientRect()
      const x = clientX - rect.left
      const y = clientY - rect.top
      const w = rect.width + RIPPLE_PADDING
      const h = rect.height + RIPPLE_PADDING

      const corners = [
        [0, 0],
        [w, 0],
        [0, h],
        [w, h],
      ] as const

      const distances = corners.map(([cx, cy]) =>
        Math.sqrt((cx - x) ** 2 + (cy - y) ** 2),
      )

      const radius = Math.max(...distances) * 2

      const newRipple: Ripple = {
        id: `${rippleId}-${rippleCountRef.current++}`,
        x,
        y,
        radius,
        shouldFade: false,
      }

      activeRipplesRef.current.set(event.pointerId, newRipple.id)
      setRipples((prev) => [...prev, newRipple])
    },
    [rippleId],
  )

  useEffect(() => {
    const el =
      target instanceof HTMLElement
        ? target
        : (target as React.RefObject<HTMLElement | null>)?.current
    if (!el) return

    el.addEventListener('pointerenter', handlePointerEnter)
    el.addEventListener('pointerleave', handlePointerLeave)
    el.addEventListener('pointerdown', handlePointerDown)
    el.addEventListener('pointerup', handlePointerUp)
    el.addEventListener('pointercancel', handlePointerUp)

    return () => {
      el.removeEventListener('pointerenter', handlePointerEnter)
      el.removeEventListener('pointerleave', handlePointerLeave)
      el.removeEventListener('pointerdown', handlePointerDown)
      el.removeEventListener('pointerup', handlePointerUp)
      el.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [
    target,
    handlePointerEnter,
    handlePointerLeave,
    handlePointerDown,
    handlePointerUp,
  ])

  return ripples.map((ripple) =>
    React.createElement(motion.span, {
      key: ripple.id,
      className: `pointer-events-none absolute rounded-full`,
      style: {
        left: ripple.x,
        top: ripple.y,
        background: color,
        filter: 'blur(12px)',
        zIndex,
      },
      initial: {
        width: 0,
        height: 0,
        opacity: 1,
        x: 0,
        y: 0,
      },
      animate: {
        width: ripple.radius,
        height: ripple.radius,
        opacity: ripple.shouldFade ? 0 : 0.5,
        x: -ripple.radius / 2,
        y: -ripple.radius / 2,
      },
      transition: {
        width: {
          duration: rippleDuration / 1000,
          ease: [0.25, 1, 0.8, 1],
        },
        height: {
          duration: rippleDuration / 1000,
          ease: [0.25, 1, 0.8, 1],
        },
        opacity: {
          duration: ripple.shouldFade
            ? fadeDuration / 1000
            : rippleDuration / 1000,
          ease: ripple.shouldFade ? 'easeOut' : 'easeOut',
        },
        x: {
          duration: rippleDuration / 1000,
          ease: [0.25, 1, 0.8, 1],
        },
        y: {
          duration: rippleDuration / 1000,
          ease: [0.25, 1, 0.8, 1],
        },
      },
    }),
  )
}

function backgroundFor(variant?: ButtonVariant, isHovered?: boolean): string {
  switch (variant) {
    case 'primary':
    case undefined:
      return 'color-mix(in srgb, var(--on-primary) 30%, transparent)'
    case 'secondary':
      return 'color-mix(in srgb, var(--on-secondary) 30%, transparent)'
    case 'tertiary':
      return 'color-mix(in srgb, var(--on-tertiary) 30%, transparent)'
    case 'destructive':
      return 'color-mix(in srgb, var(--on-error-container) 30%, transparent)'
    case 'ghost':
      return isHovered
        ? 'color-mix(in srgb, var(--on-secondary) 30%, transparent)'
        : 'color-mix(in srgb, var(--primary) 30%, transparent)'
    default: // surface, outline, input, link, stealth
      return 'color-mix(in srgb, var(--primary) 30%, transparent)'
  }
}

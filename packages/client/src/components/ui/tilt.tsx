
import { cn } from '@/lib/utils'
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react'
import type React from 'react'
import { useRef } from 'react'

export type TiltProps = {
  /** Max degrees to tilt on each axis */
  max?: number
  /** CSS perspective value in px */
  perspective?: number
  /** Hover scale factor */
  scale?: number
  /** Spring stiffness */
  stiffness?: number
  /** Spring damping */
  damping?: number
  /** Show a parallaxed outline layer that tracks the cursor */
  parallaxOutline?: boolean
  /** Max pixel translation for the outline parallax */
  parallaxAmount?: number
  /** Extra class names for the outline element */
  parallaxOutlineClassName?: string
  /** Extra outward inset (px) for the outline layer; negative values move it inward */
  parallaxOutlineInset?: number
  /** Disable tilt */
  disabled?: boolean
  children: React.ReactNode
  className?: string
} & React.ComponentPropsWithoutRef<typeof motion.div>

export function Tilt({
  max = 5,
  perspective = 900,
  scale = 1,
  stiffness = 180,
  damping = 16,
  parallaxOutline = false,
  parallaxAmount = 8,
  parallaxOutlineClassName,
  parallaxOutlineInset = -10,
  disabled = false,
  children,
  className,
  ...rest
}: TiltProps) {
  const ref = useRef<HTMLDivElement>(null)

  // Normalized cursor position within the element (-0.5..0.5)
  const mx = useMotionValue(0)
  const my = useMotionValue(0)

  // Tilt
  // prettier-ignore
  const rotateY = useSpring(
    useTransform(mx, [-0.5, 0, 0.5], [-max, 0, max]),
    { stiffness, damping, mass: 0.4 }
  )
  // prettier-ignore
  const rotateX = useSpring(
    useTransform(my, [-0.5, 0, 0.5], [max, 0, -max]),
    { stiffness, damping, mass: 0.4 }
  )

  // Parallax
  // prettier-ignore
  const tx = useSpring(
    useTransform(mx, [-0.5, 0, 0.5], [parallaxAmount, 0, -parallaxAmount]),
    { stiffness, damping, mass: 0.4 }
  )
  // prettier-ignore
  const ty = useSpring(
    useTransform(my, [-0.5, 0, 0.5], [parallaxAmount, 0, -parallaxAmount]),
    { stiffness, damping, mass: 0.4 }
  )

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (disabled) return
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width - 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5
    mx.set(x)
    my.set(y)
  }

  function handleMouseLeave() {
    mx.set(0)
    my.set(0)
  }

  if (disabled) {
    scale = 1
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ rotateX, rotateY, transformPerspective: perspective }}
      whileHover={{ scale, transition: { duration: 0.2 } }}
      className={cn(
        'relative transform-gpu will-change-transform transform-3d',
        className,
      )}
      {...rest}
    >
      {parallaxOutline && (
        <motion.div
          aria-hidden
          className={cn(
            'pointer-events-none absolute rounded-lg border',
            parallaxOutlineClassName,
          )}
          style={{
            x: tx,
            y: ty,
            top: -parallaxOutlineInset,
            right: -parallaxOutlineInset,
            bottom: -parallaxOutlineInset,
            left: -parallaxOutlineInset,
          }}
        />
      )}
      {children}
    </motion.div>
  )
}

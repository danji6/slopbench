
import { useMorph, useStyleProperty } from '@/hooks'
import type { RoundedPolygon } from '@/lib/shapes'
import { type HTMLMotionProps, motion } from 'motion/react'
import { useState } from 'react'

export type MorphingShapeProps = {
  shapes: RoundedPolygon[]
  size?: number
  width?: number
  height?: number
  delay?: number
  method?: 'autoplay' | 'press' | 'hover'
  randomize?: boolean
  stiffness?: number
  damping?: number
  fill?: string
  spin?: boolean
} & HTMLMotionProps<'canvas'>

export function MorphingShape({
  shapes,
  size,
  width,
  height,
  delay,
  method,
  randomize,
  stiffness,
  damping,
  fill,
  spin,
  ...props
}: MorphingShapeProps) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)

  const canvasWidth = width ?? size ?? 100
  const canvasHeight = height ?? size ?? 100
  const fillProp = useStyleProperty(fill || '--primary', canvas)

  useMorph(canvas, shapes, {
    delay,
    method,
    randomize,
    stiffness,
    damping,
    fill: fillProp,
    spin,
  })

  return (
    <motion.canvas
      ref={setCanvas}
      width={canvasWidth}
      height={canvasHeight}
      {...props}
    />
  )
}

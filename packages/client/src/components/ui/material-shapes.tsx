import { Shapes } from '@/lib/shapes'
import { shuffle } from '@/lib/utils'
import type { HTMLMotionProps } from 'motion/react'
import { useMemo } from 'react'

import { MorphingShape, type MorphingShapeProps } from '.'

export type MaterialShapesProps = Omit<MorphingShapeProps, 'shapes'> &
  HTMLMotionProps<'div'> & {
    randomize?: boolean
  }

const shapes = Object.values(Shapes).map((shape) => shape())

export function MaterialShapes({
  width = 128,
  height = 128,
  size = 128,
  delay = 400,
  randomize = false,
  method = 'autoplay',
  fill = '--primary',
  ...props
}: MaterialShapesProps) {
  const memoizedShapes = useMemo(
    () => (randomize ? shuffle(shapes) : shapes),
    [randomize],
  )

  return (
    <MorphingShape
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      shapes={memoizedShapes}
      size={size}
      width={width}
      height={height}
      delay={delay}
      method={method}
      fill={fill}
      {...props}
    />
  )
}

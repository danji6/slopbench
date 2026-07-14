import { Shapes } from '@/lib/shapes'
import { cn, shuffle } from '@/lib/utils'
import { type HTMLMotionProps, motion } from 'motion/react'

import { MorphingShape } from './morphing-shape'

const shapes = [
  Shapes.softBurst(),
  Shapes.cookie9Sided(),
  Shapes.pentagon(),
  Shapes.pill(),
  Shapes.sunny(),
  Shapes.cookie4Sided(),
  Shapes.oval(),
]

export type LoadingIndicatorProps = {
  size?: number
  fill?: string
  randomize?: boolean
  className?: string
} & HTMLMotionProps<'div'>

export function LoadingIndicator({
  size = 128,
  fill = '--inverse-primary',
  randomize = false,
  className,
  ...props
}: LoadingIndicatorProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn('bg-primary relative rounded-full p-1', className)}
      {...props}
    >
      <MorphingShape
        shapes={randomize ? shuffle(shapes) : shapes}
        size={size}
        width={size}
        height={size}
        delay={150}
        method="autoplay"
        stiffness={0.1}
        damping={0.4}
        fill={fill}
        spin={true}
      />
    </motion.div>
  )
}

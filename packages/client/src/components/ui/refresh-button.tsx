
import { useRender } from '@base-ui/react/use-render'
import { animate, motion, useMotionValue } from 'framer-motion'
import { RefreshCwIcon } from 'lucide-react'
import { useRef } from 'react'

import { type Button, RippleButton } from '.'

export function RefreshButton({
  onClick,
  render = <RippleButton />,
  ...props
}: {
  onClick?: () => void
} & React.ComponentProps<typeof Button>) {
  const rotation = useMotionValue(0)
  const targetRotation = useRef(0)

  return useRender({
    render,
    props: {
      onClick: () => {
        targetRotation.current += 360
        animate(rotation, targetRotation.current, {
          duration: 0.8,
          ease: 'easeOut',
          onComplete: () => {
            rotation.set(0)
            targetRotation.current = 0
          },
        })
        onClick?.()
      },
      size: 'icon',
      ...props,
      children: (
        <motion.div style={{ rotate: rotation }}>
          <RefreshCwIcon />
        </motion.div>
      ),
    },
  })
}

import { useStep } from '@/hooks/step'
import { clamp } from '@/lib/math'
import { cn } from '@/lib/utils'
import { MinusIcon, PlusIcon } from 'lucide-react'
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
} from 'motion/react'
import type React from 'react'
import { useRef, useState } from 'react'

import { RippleButton, type RippleButtonProps } from './ripple-button'

const MAX_OVERFLOW = 50

export type FancySliderProps = {
  value?: number
  minValue?: number
  maxValue?: number
  onChange?: (value: number) => void
  isStepped?: boolean
  stepSize?: number
  showValue?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  className?: string
} & Omit<React.ComponentProps<'div'>, 'onChange'>

// TODO fix shaking when hovering over slider
export function FancySlider({
  value = 50,
  minValue = 0,
  maxValue = 100,
  onChange = () => {},
  className = '',
  isStepped = false,
  stepSize = 1,
  showValue = true,
  leftIcon = <MinusIcon />,
  rightIcon = <PlusIcon />,
  ...props
}: FancySliderProps) {
  const sliderRef = useRef<HTMLDivElement>(null)
  const [region, setRegion] = useState<'left' | 'middle' | 'right'>('middle')
  const clientX = useMotionValue(0)
  const overflow = useMotionValue(0)
  const scale = useMotionValue(1)

  const [, setStepDirection] = useStep((direction) => {
    const newValue = clamp(value + direction * stepSize, minValue, maxValue)
    if (newValue !== value) {
      onChange(newValue)
    }
  })

  useMotionValueEvent(clientX, 'change', (latest: number) => {
    if (sliderRef.current) {
      const { left, right } = sliderRef.current.getBoundingClientRect()
      let newValue: number
      if (latest < left) {
        setRegion('left')
        newValue = left - latest
      } else if (latest > right) {
        setRegion('right')
        newValue = latest - right
      } else {
        setRegion('middle')
        newValue = 0
      }
      overflow.jump(decay(newValue, MAX_OVERFLOW))
    }
  })

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons > 0 && sliderRef.current) {
      const { left, width } = sliderRef.current.getBoundingClientRect()
      let newValue =
        minValue + ((e.clientX - left) / width) * (maxValue - minValue)
      if (isStepped) {
        newValue = Math.round(newValue / stepSize) * stepSize
      }
      newValue = Math.min(Math.max(newValue, minValue), maxValue)
      onChange(newValue)
      clientX.jump(e.clientX)
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    handlePointerMove(e)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerUp = () => {
    animate(overflow, 0, { type: 'spring', bounce: 0.5 })
  }

  const handleButtonPointerUp = () => {
    setStepDirection(0)
  }

  const getRangePercentage = (): number => {
    const totalRange = maxValue - minValue
    if (totalRange === 0) return 0
    return ((value - minValue) / totalRange) * 100
  }

  return (
    <div
      className={cn(
        'flex w-48 flex-col items-center justify-center gap-4',
        className,
      )}
      {...props}
    >
      <motion.div
        onHoverStart={() => animate(scale, 1.2)}
        onHoverEnd={() => animate(scale, 1)}
        onTouchStart={() => animate(scale, 1.2)}
        onTouchEnd={() => animate(scale, 1)}
        style={{
          scale,
          opacity: useTransform(scale, [1, 1.2], [0.7, 1]),
        }}
        className="flex w-full touch-none items-center justify-center gap-2 select-none"
      >
        <motion.div
          animate={{
            scale: region === 'left' ? [1, 1.4, 1] : 1,
            transition: { duration: 0.25 },
          }}
          style={{
            x: useTransform(() =>
              region === 'left' ? -overflow.get() / scale.get() : 0,
            ),
          }}
        >
          <IconButton
            onPointerDown={() => setStepDirection(-1)}
            onPointerUp={handleButtonPointerUp}
            onPointerLeave={handleButtonPointerUp}
          >
            {leftIcon}
          </IconButton>
        </motion.div>

        <div
          ref={sliderRef}
          className="relative flex h-11 w-full max-w-xs grow cursor-grab touch-none items-center py-4 select-none"
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
        >
          <motion.div
            style={{
              scaleX: useTransform(() => {
                if (sliderRef.current) {
                  const { width } = sliderRef.current.getBoundingClientRect()
                  return 1 + overflow.get() / width
                }
                return 1
              }),
              scaleY: useTransform(overflow, [0, MAX_OVERFLOW], [1, 0.8]),
              transformOrigin: useTransform(() => {
                if (sliderRef.current) {
                  const { left, width } =
                    sliderRef.current.getBoundingClientRect()
                  return clientX.get() < left + width / 2 ? 'right' : 'left'
                }
                return 'center'
              }),
              height: useTransform(scale, [1, 1.2], [6, 12]),
              marginTop: useTransform(scale, [1, 1.2], [0, -3]),
              marginBottom: useTransform(scale, [1, 1.2], [0, -3]),
            }}
            className="flex grow"
          >
            <div className="bg-m3-secondary-container relative h-full grow overflow-hidden rounded-full">
              <div
                className="bg-m3-primary absolute h-full rounded-full"
                style={{ width: `${getRangePercentage()}%` }}
              />
            </div>
          </motion.div>
        </div>

        <motion.div
          animate={{
            scale: region === 'right' ? [1, 1.4, 1] : 1,
            transition: { duration: 0.25 },
          }}
          style={{
            x: useTransform(() =>
              region === 'right' ? overflow.get() / scale.get() : 0,
            ),
          }}
        >
          <IconButton
            onPointerDown={() => setStepDirection(1)}
            onPointerUp={handleButtonPointerUp}
            onPointerLeave={handleButtonPointerUp}
          >
            {rightIcon}
          </IconButton>
        </motion.div>
      </motion.div>
      {showValue && (
        <p className="text-foreground pointer-events-none absolute -translate-y-4 transform text-xs font-medium tracking-wide">
          {Math.round(value)}
        </p>
      )}
    </div>
  )
}

function IconButton({
  children,
  ...props
}: { children: React.ReactNode } & RippleButtonProps) {
  return (
    <RippleButton
      size="icon"
      variant="link"
      className="flex size-6 justify-center"
      {...props}
    >
      {children}
    </RippleButton>
  )
}

function decay(value: number, max: number): number {
  if (max === 0) {
    return 0
  }
  const entry = value / max
  const sigmoid = 2 * (1 / (1 + Math.exp(-entry)) - 0.5)
  return sigmoid * max
}

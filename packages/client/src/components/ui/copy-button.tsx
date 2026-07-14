
import { useTimeoutState } from '@/hooks'
import { Result } from '@/lib/result'
import { isTouchDevice } from '@/lib/utils'
import { mergeProps } from '@base-ui/react/merge-props'
import type { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { RippleButton, Tooltip } from '.'
import { Morph } from './morph'
import type { RippleButtonProps } from './ripple-button'

export type CopyButtonProps = {
  tooltip?: string
  tooltipSide?:
    | 'top'
    | 'bottom'
    | 'left'
    | 'right'
    | 'inline-end'
    | 'inline-start'
  value: string | (() => string)
  onChange?: (isCopied: boolean) => void
  variant?: RippleButtonProps['variant']
} & Omit<TooltipPrimitive.Trigger.Props, 'onChange' | 'value'>

export function CopyButton({
  tooltip,
  tooltipSide,
  value,
  onChange,
  render,
  variant = 'surface',
  ...props
}: CopyButtonProps) {
  const isTouch = isTouchDevice()
  const [isOver, setIsOver] = useState(false)
  const [isHovered, setHovered] = useState(false)
  const [isCopied, setCopied] = useTimeoutState(false, 2000)
  const [displayedCopied, setDisplayedCopied] = useState(false)
  const [keepOpenAfterCopy, setKeepOpenAfterCopy] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setHovered(isOver), isOver ? 200 : 0)
    return () => clearTimeout(timer)
  }, [isOver])

  useEffect(() => {
    if (isCopied) return
    if (isHovered) {
      const t = setTimeout(() => {
        setKeepOpenAfterCopy(false)
        setDisplayedCopied(false)
      }, 0)
      return () => clearTimeout(t)
    }
    const closeT = setTimeout(() => setKeepOpenAfterCopy(false), 0)
    const swapT = setTimeout(() => setDisplayedCopied(false), 250)
    return () => {
      clearTimeout(closeT)
      clearTimeout(swapT)
    }
  }, [isCopied, isHovered])

  async function handleCopy() {
    await Result.from(
      navigator.clipboard.writeText(
        typeof value === 'string' ? value : value(),
      ),
    ).catch()
    if (isTouch) setHovered(true)
    setDisplayedCopied(true)
    setKeepOpenAfterCopy(true)
    setCopied(true, (isCopied) => {
      onChange?.(isCopied)
      if (isTouch && !isCopied) {
        setHovered(false)
      }
    })
  }

  return (
    <Tooltip.Provider>
      <Tooltip open={isHovered || keepOpenAfterCopy}>
        <Tooltip.Trigger
          {...mergeProps(props, {
            render: render ?? (
              <RippleButton size="icon" variant={variant}>
                <Morph morphKey={String(displayedCopied)}>
                  {displayedCopied ? <CheckIcon /> : <CopyIcon />}
                </Morph>
              </RippleButton>
            ),
            onMouseEnter: () => setIsOver(true),
            onMouseLeave: () => setIsOver(false),
            onClick: handleCopy,
          })}
        />
        <Tooltip.Content side={tooltipSide}>
          {displayedCopied ? (
            <p className="flex flex-nowrap items-center gap-1">
              <CheckIcon className="size-4" />
              Copied
            </p>
          ) : (
            <p>{tooltip ?? 'Copy'}</p>
          )}
        </Tooltip.Content>
      </Tooltip>
    </Tooltip.Provider>
  )
}

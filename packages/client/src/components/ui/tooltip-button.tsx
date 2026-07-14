import { isTouchDevice } from '@/lib/utils'
import { mergeProps } from '@base-ui/react/merge-props'
import type { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'

import { RippleButton, Tooltip } from '.'
import type { RippleButtonProps } from './ripple-button'

export type TooltipButtonProps = RippleButtonProps &
  Pick<
    TooltipPrimitive.Trigger.Props,
    'onMouseEnter' | 'onMouseLeave' | 'render'
  > & {
    tooltip?: string
    tooltipSide?:
      | 'top'
      | 'bottom'
      | 'left'
      | 'right'
      | 'inline-end'
      | 'inline-start'
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
  }

export function TooltipButton(props: TooltipButtonProps) {
  const isTouch = isTouchDevice()

  const {
    tooltip,
    tooltipSide,
    children,
    onMouseEnter,
    onMouseLeave,
    onClick,
    render,
    ...rest
  } = props

  const button = (
    <RippleButton size="icon" {...rest} onClick={onClick} aria-label={tooltip}>
      {children}
    </RippleButton>
  )

  if (isTouch) {
    return button
  }

  return (
    <Tooltip.Provider delay={200}>
      <Tooltip>
        <Tooltip.Trigger
          {...mergeProps(
            { onMouseEnter, onMouseLeave, render },
            { render: button },
          )}
        />
        <Tooltip.Content side={tooltipSide}>
          <p>{tooltip}</p>
        </Tooltip.Content>
      </Tooltip>
    </Tooltip.Provider>
  )
}

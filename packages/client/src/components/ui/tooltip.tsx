import { cn } from '@/lib/utils'
import { useThemeScope } from '@/providers/theme-scope'
import { mergeProps } from '@base-ui/react/merge-props'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { createContext, useContext, useId, useMemo } from 'react'

import { useTooltipLongPress } from './tooltip-long-press'

const DEFAULT_LONG_PRESS_DELAY = 500
const DEFAULT_LONG_PRESS_CLOSE_DELAY = 1500

type TooltipLongPressContextValue = {
  enabled: boolean
  delay: number
  closeDelay: number
  handle: TooltipPrimitive.Handle<unknown>
}

const TooltipLongPressContext =
  createContext<TooltipLongPressContextValue | null>(null)

type TooltipRootProps = TooltipPrimitive.Root.Props & {
  longPress?: boolean
  longPressDelay?: number
  longPressCloseDelay?: number
}

function TooltipProvider({
  delay = 0,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  )
}

function TooltipRoot({
  longPress = false,
  longPressDelay = DEFAULT_LONG_PRESS_DELAY,
  longPressCloseDelay = DEFAULT_LONG_PRESS_CLOSE_DELAY,
  handle: handleProp,
  ...props
}: TooltipRootProps) {
  const internalHandle = useMemo(() => TooltipPrimitive.createHandle(), [])
  const handle = handleProp ?? internalHandle

  return (
    <TooltipLongPressContext.Provider
      value={{
        enabled: longPress,
        delay: longPressDelay,
        closeDelay: longPressCloseDelay,
        handle,
      }}
    >
      <TooltipPrimitive.Root data-slot="tooltip" handle={handle} {...props} />
    </TooltipLongPressContext.Provider>
  )
}

function TooltipTrigger({
  id: idProp,
  handle: handleProp,
  ...props
}: TooltipPrimitive.Trigger.Props) {
  const context = useContext(TooltipLongPressContext)
  const generatedId = useId()
  const internalHandle = useMemo(() => TooltipPrimitive.createHandle(), [])
  const id = idProp ?? generatedId
  const handle = handleProp ?? context?.handle ?? internalHandle
  const longPressProps = useTooltipLongPress({
    enabled: context?.enabled ?? false,
    delay: context?.delay ?? DEFAULT_LONG_PRESS_DELAY,
    closeDelay: context?.closeDelay ?? DEFAULT_LONG_PRESS_CLOSE_DELAY,
    handle,
    triggerId: id,
  })

  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      id={id}
      handle={handle}
      {...mergeProps(longPressProps, props)}
    />
  )
}

function TooltipContent({
  className,
  side = 'top',
  sideOffset = 8,
  align = 'center',
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    'align' | 'alignOffset' | 'side' | 'sideOffset'
  >) {
  const themeScope = useThemeScope()

  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className={cn('z-55', themeScope)}
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            'bg-m3-inverse-surface text-m3-inverse-on-surface popup-motion z-55 w-fit max-w-xs origin-(--transform-origin) rounded-md px-3 py-1.5 text-xs wrap-break-word',
            className,
          )}
          {...props}
        >
          {children}
          <TooltipArrow />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

function TooltipArrow({ className, ...props }: TooltipPrimitive.Arrow.Props) {
  return (
    <TooltipPrimitive.Arrow
      data-slot="tooltip-arrow"
      className={cn(
        'bg-m3-inverse-surface fill-m3-inverse-surface z-55 size-2.5 rotate-45 rounded-[2px]',
        'data-[side=bottom]:top-px data-[side=bottom]:-translate-y-1/2',
        'data-[side=top]:bottom-px data-[side=top]:translate-y-1/2',
        'data-[side=left]:right-px data-[side=left]:translate-x-1/2',
        'data-[side=right]:left-px data-[side=right]:-translate-x-1/2',
        className,
      )}
      {...props}
    />
  )
}

export const Tooltip = Object.assign(TooltipRoot, {
  Trigger: TooltipTrigger,
  Content: TooltipContent,
  Provider: TooltipProvider,
})

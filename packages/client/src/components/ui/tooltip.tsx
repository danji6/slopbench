import { cn } from '@/lib/utils'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'

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

function TooltipRoot({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
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
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="z-55"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            'bg-m3-inverse-surface text-m3-inverse-on-surface animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-55 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance',
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

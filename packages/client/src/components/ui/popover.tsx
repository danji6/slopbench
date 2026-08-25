import { cn } from '@/lib/utils'
import { useThemeScope } from '@/providers/theme-scope'
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import { createContext, useContext, useEffect, useRef } from 'react'

type PopoverActionsRef = NonNullable<PopoverPrimitive.Root.Props['actionsRef']>

const PopoverActionsContext = createContext<PopoverActionsRef | null>(null)

function PopoverRoot({ actionsRef, ...props }: PopoverPrimitive.Root.Props) {
  const internalActionsRef = useRef<PopoverPrimitive.Root.Actions | null>(null)
  const rootActionsRef = actionsRef ?? internalActionsRef

  return (
    <PopoverActionsContext.Provider value={rootActionsRef}>
      <PopoverPrimitive.Root
        data-slot="popover"
        actionsRef={rootActionsRef}
        {...props}
      />
    </PopoverActionsContext.Provider>
  )
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverClose({ ...props }: PopoverPrimitive.Close.Props) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />
}

function PopoverContent({
  className,
  align = 'center',
  alignOffset = 0,
  positionMethod = 'fixed',
  side = 'bottom',
  sideOffset = 4,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    'align' | 'alignOffset' | 'positionMethod' | 'side' | 'sideOffset'
  >) {
  const actionsRef = useContext(PopoverActionsContext)
  const themeScope = useThemeScope()

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        positionMethod={positionMethod}
        side={side}
        sideOffset={sideOffset}
        className={(state) =>
          cn(
            'isolate z-55',
            themeScope,
            state.anchorHidden && 'pointer-events-none opacity-0',
          )
        }
        render={(positionerProps, state) => (
          <PopoverPositionerElement
            {...positionerProps}
            actionsRef={actionsRef}
            anchorHidden={state.anchorHidden}
            open={state.open}
          />
        )}
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            'bg-popover text-popover-foreground ring-foreground/10 popup-motion z-50 flex w-90 max-w-[calc(100dvw-2rem)] origin-(--transform-origin) flex-col gap-2.5 rounded-lg p-2.5 text-sm shadow-md ring-1 outline-hidden duration-100',
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

type PopoverPositionerElementProps = React.ComponentProps<'div'> & {
  actionsRef: PopoverActionsRef | null
  anchorHidden: boolean
  open: boolean
}

function PopoverPositionerElement({
  actionsRef,
  anchorHidden,
  open,
  ...props
}: PopoverPositionerElementProps) {
  useEffect(() => {
    if (open && anchorHidden) actionsRef?.current?.close()
  }, [actionsRef, anchorHidden, open])

  return <div {...props} />
}

function PopoverHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="popover-header"
      className={cn('flex flex-col gap-0.5 text-sm', className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn('font-medium', className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn('text-muted-foreground', className)}
      {...props}
    />
  )
}

export const Popover = Object.assign(PopoverRoot, {
  Close: PopoverClose,
  Content: PopoverContent,
  Description: PopoverDescription,
  Header: PopoverHeader,
  Title: PopoverTitle,
  Trigger: PopoverTrigger,
})

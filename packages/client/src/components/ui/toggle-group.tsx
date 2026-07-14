
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group'

function ToggleGroupRoot({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive>) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      className={cn('flex w-fit items-center gap-1', className)}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive>
  )
}

function ToggleGroupItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Toggle>) {
  return (
    <Toggle
      data-slot="toggle-group-item"
      className={cn(
        'min-w-0 flex-1 shrink-0 focus:z-10 focus-visible:z-10',
        className,
      )}
      {...props}
    >
      {children}
    </Toggle>
  )
}

export const ToggleGroup = Object.assign(ToggleGroupRoot, {
  Item: ToggleGroupItem,
})

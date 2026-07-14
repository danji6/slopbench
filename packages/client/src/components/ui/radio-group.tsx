import { cn } from '@/lib/utils'
import { Radio as RadioPrimitive } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'

function RadioGroupRoot({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn('grid w-full gap-2', className)}
      {...props}
    />
  )
}

function RadioGroupItem({
  className,
  children,
  ...props
}: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      className={cn(
        'group/radio-item flex cursor-pointer items-center gap-2.5 outline-none select-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <div className="border-m3-outline group-data-checked/radio-item:border-m3-primary focus-visible:ring-ring relative flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors focus-visible:ring-1">
        <RadioPrimitive.Indicator
          data-slot="radio-group-indicator"
          className="flex size-full items-center justify-center"
        >
          <div className="bg-m3-primary animate-in fade-in zoom-in-50 size-2.5 rounded-full duration-200" />
        </RadioPrimitive.Indicator>
      </div>
      {children && (
        <span className="text-sm leading-none font-medium">{children}</span>
      )}
    </RadioPrimitive.Root>
  )
}

export const RadioGroup = Object.assign(RadioGroupRoot, {
  Item: RadioGroupItem,
})

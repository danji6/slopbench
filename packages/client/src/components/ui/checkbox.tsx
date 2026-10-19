import { cn } from '@/lib/utils'
import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { cva } from 'class-variance-authority'
import { CheckIcon, MinusIcon } from 'lucide-react'

/** Keeps checked colors until the indicator finishes its exit animation. */
const checkboxVariants = cva(
  'peer focus-visible:border-ring focus-visible:ring-ring aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary relative flex shrink-0 cursor-pointer items-center justify-center rounded-xs border-2 outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-1',
  {
    variants: {
      size: {
        default: 'size-5',
        sm: 'size-4',
        xs: 'size-3.5',
      },
      variant: {
        default:
          'border-m3-outline text-m3-on-primary has-data-[slot=checkbox-indicator]:border-primary has-data-[slot=checkbox-indicator]:bg-primary',
        muted:
          'has-data-[slot=checkbox-indicator]:bg-muted has-data-[slot=checkbox-indicator]:text-muted-foreground',
      },
    },
  },
)

export type CheckboxProps = CheckboxPrimitive.Root.Props & {
  variant?: 'default' | 'muted'
  size?: 'default' | 'sm' | 'xs'
  className?: string
}

function Checkbox({
  variant = 'default',
  size = 'default',
  className,
  ...props
}: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(checkboxVariants({ variant, size }), className)}
      {...props}
    >
      {/* Keep the resting scale explicit to avoid a rendering shift after motion. */}
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="group/checkbox-indicator flex size-full scale-100 items-center justify-center p-px text-current transition-[opacity,scale] duration-150 ease-in-out data-ending-style:scale-50 data-ending-style:opacity-0 data-starting-style:scale-50 data-starting-style:opacity-0 motion-reduce:transition-none [&>svg]:size-full"
      >
        <CheckIcon
          strokeWidth={3}
          className="group-data-indeterminate/checkbox-indicator:hidden"
        />
        <MinusIcon
          strokeWidth={3}
          className="hidden group-data-indeterminate/checkbox-indicator:block"
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }

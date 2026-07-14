import { cn } from '@/lib/utils'
import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { cva } from 'class-variance-authority'
import { CheckIcon, MinusIcon } from 'lucide-react'

const checkboxVariants = cva(
  'peer focus-visible:border-ring focus-visible:ring-ring aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary relative flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-xs border-2 outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-1',
  {
    variants: {
      variant: {
        default:
          'border-m3-outline data-checked:bg-primary data-indeterminate:bg-primary text-m3-on-primary data-checked:border-primary data-indeterminate:border-primary',
        muted:
          'data-checked:bg-muted data-indeterminate:bg-muted data-checked:text-muted-foreground data-indeterminate:text-muted-foreground',
      },
    },
  },
)

export type CheckboxProps = CheckboxPrimitive.Root.Props & {
  variant?: 'default' | 'muted'
  className?: string
}

function Checkbox({ variant = 'default', className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(checkboxVariants({ variant }), className)}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className={cn(
          'group/checkbox-indicator grid place-content-center text-current',
          variant === 'default' ? '[&>svg]:size-4.5' : '[&>svg]:size-4',
        )}
      >
        <CheckIcon
          strokeWidth={3}
          className="animate-in fade-in zoom-in-50 group-data-indeterminate/checkbox-indicator:hidden"
        />
        <MinusIcon
          strokeWidth={3}
          className="animate-in fade-in zoom-in-50 hidden group-data-indeterminate/checkbox-indicator:block"
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }

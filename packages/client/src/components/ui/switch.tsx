import { cn } from '@/lib/utils'
import { Switch as SwitchPrimitive } from '@base-ui/react/switch'
import { type VariantProps, cva } from 'class-variance-authority'
import { Check } from 'lucide-react'
import { useId } from 'react'

const switchVariants = cva(
  'peer group/switch focus-visible:border-ring focus-visible:ring-ring aria-invalid:border-destructive aria-invalid:ring-destructive/20 relative inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-1 aria-invalid:ring-1 data-disabled:cursor-not-allowed data-disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'data-unchecked:border-m3-outline data-checked:bg-m3-primary data-unchecked:bg-m3-surface-container',
      },
      size: {
        default: 'h-8 w-14',
        sm: 'h-7 w-11',
        xs: 'h-6 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

const thumbVariants = cva(
  'pointer-events-none absolute inset-y-0 left-0 my-auto flex items-center justify-center rounded-full ring-0 transition-all duration-200 ease-in-out',
  {
    variants: {
      variant: {
        default:
          'bg-m3-outline data-checked:bg-m3-on-primary group-data-checked/switch:bg-m3-on-primary',
      },
      size: {
        default:
          'data-checked:h-[28px] data-checked:w-[28px] data-checked:translate-x-6 data-unchecked:h-[17.5px] data-unchecked:w-[17.5px] data-unchecked:translate-x-1',
        sm: 'data-checked:h-[22px] data-checked:w-[22px] data-checked:translate-x-4.5 data-unchecked:h-[16px] data-unchecked:w-[16px] data-unchecked:translate-x-1',
        xs: 'data-checked:h-[18px] data-checked:w-[18px] data-checked:translate-x-3.5 data-unchecked:h-[12px] data-unchecked:w-[12px] data-unchecked:translate-x-1',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface SwitchProps
  extends SwitchPrimitive.Root.Props, VariantProps<typeof switchVariants> {}

function Switch({
  className,
  variant,
  size,
  children,
  id: providedId,
  ...props
}: SwitchProps) {
  const generatedId = useId()
  const id = providedId ?? generatedId

  const root = (
    <SwitchPrimitive.Root
      id={id}
      data-slot="switch"
      className={cn(switchVariants({ variant, size }))}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(thumbVariants({ variant, size }))}
      >
        <Check
          className={cn(
            'text-m3-primary absolute scale-0 opacity-0 transition-all duration-200 group-data-checked/switch:scale-100 group-data-checked/switch:opacity-100',
            size === 'xs' ? 'size-3' : size === 'sm' ? 'size-4' : 'size-5',
          )}
        />
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  )

  if (!children) return root

  return (
    <label
      htmlFor={id}
      className={cn(
        'flex w-32 max-w-full cursor-pointer items-center justify-between gap-5 select-none',
        className,
      )}
    >
      <span className="text-sm leading-none font-medium">{children}</span>
      {root}
    </label>
  )
}

export { Switch }

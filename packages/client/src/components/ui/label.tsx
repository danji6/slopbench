import { cn } from '@/lib/utils'
import { type VariantProps, cva } from 'class-variance-authority'

const labelVariants = cva(
  'flex items-center gap-2 leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'text-sm',
        settings: 'text-muted-foreground px-0.5 text-xs font-medium',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

interface LabelProps
  extends React.ComponentProps<'label'>, VariantProps<typeof labelVariants> {}

function Label({ className, variant, ...props }: LabelProps) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: standalone component
    <label
      data-slot="label"
      className={cn(labelVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Label }

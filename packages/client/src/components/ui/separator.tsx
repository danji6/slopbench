import { cn } from '@/lib/utils'
import { Separator as SeparatorPrimitive } from '@base-ui/react/separator'
import { type VariantProps, cva } from 'class-variance-authority'
import type * as React from 'react'

const separatorVariants = cva(
  'shrink-0 data-[orientation=horizontal]:w-full data-[orientation=horizontal]:border-t data-[orientation=vertical]:h-full data-[orientation=vertical]:border-e',
  {
    variants: {
      variant: {
        default: 'border-solid',
        dashed: 'border-dashed',
        dotted: 'border-dotted',
        double:
          'border-double p-px data-[orientation=horizontal]:border-y data-[orientation=vertical]:border-x',
      },
    },
  },
)

function Separator({
  className,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive> &
  VariantProps<typeof separatorVariants>) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      className={cn(separatorVariants({ variant: props.variant }), className)}
      {...props}
    />
  )
}

export { Separator }

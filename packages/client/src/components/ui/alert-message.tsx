import { cn } from '@/lib/utils'
import { type VariantProps, cva } from 'class-variance-authority'
import { AlertCircleIcon, AlertTriangleIcon, XIcon } from 'lucide-react'

export const alertVariants = cva('bg-background rounded-lg', {
  variants: {
    variant: {
      error: '',
      warning: '',
    },
  },
  defaultVariants: {
    variant: 'error',
  },
})

export const alertContentVariants = cva(
  'mx-auto flex h-fit max-h-30 w-full items-center gap-3 overflow-hidden rounded-2xl border px-4 py-2.5 text-sm',
  {
    variants: {
      variant: {
        error: 'bg-destructive/10 text-destructive border-destructive/20',
        warning: 'bg-warning/10 text-warning border-warning/20',
      },
    },
    defaultVariants: {
      variant: 'error',
    },
  },
)

export type AlertMessageVariant = VariantProps<
  typeof alertContentVariants
>['variant']

export type AlertMessageProps = React.ComponentProps<'div'> &
  VariantProps<typeof alertVariants> & {
    onDismiss?: () => void
    dismissible?: boolean
    contentClassName?: string
    childrenClassName?: string
  }

export function AlertMessage({
  children,
  onDismiss,
  className,
  contentClassName,
  childrenClassName,
  variant = 'error',
  dismissible = true,
  ...rest
}: AlertMessageProps) {
  return (
    <div
      data-slot="alert-message"
      className={cn(alertVariants({ variant }), className)}
      {...rest}
    >
      <div className={cn(alertContentVariants({ variant }), contentClassName)}>
        {variant === 'warning' ? (
          <AlertTriangleIcon className="size-4 shrink-0" />
        ) : (
          <AlertCircleIcon className="size-4 shrink-0" />
        )}
        <div
          className={cn(
            'h-fit max-h-30 flex-1 overflow-y-auto py-1',
            childrenClassName,
          )}
        >
          {children}
        </div>
        {dismissible && (
          <button
            type="button"
            onClick={onDismiss}
            className={cn(
              'rounded-full p-2 transition-colors',
              variant === 'warning' && 'hover:bg-warning/20',
              variant === 'error' && 'hover:bg-destructive/20',
            )}
            aria-label="Dismiss error"
          >
            <XIcon className="size-3" />
          </button>
        )}
      </div>
    </div>
  )
}

import { cn } from '@/lib/utils'

export function FancyHR({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'hr'>) {
  return (
    <hr
      className={cn(
        'my-4 h-0.5 w-full rounded border-0 bg-[linear-gradient(to_right,transparent,color-mix(in_oklch,var(--base-border)_70%,var(--base-primary)),transparent)] p-px [mask:linear-gradient(#000_0_0)_content-box,linear-gradient(#000_0_0)]',
        className,
      )}
      {...props}
    />
  )
}

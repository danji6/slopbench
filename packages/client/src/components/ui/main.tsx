import { cn } from '@/lib/utils'

export function Main({
  children,
  className,
  ...props
}: {
  children?: React.ReactNode
  className?: string
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <main
      className={cn(
        'mx-auto flex w-dvw flex-col items-center pt-2 pb-20',
        className,
      )}
      {...props}
    >
      {children}
    </main>
  )
}

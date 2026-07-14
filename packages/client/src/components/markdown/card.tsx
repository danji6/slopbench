
import { cn } from '@/lib/utils'

import { Card } from '../ui'

export function MarkdownCard({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return <Card.Root className={cn('gap-0 p-0', className)} {...props} />
}

export function MarkdownCardFooter({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <Card.Content aria-hidden className="py-1.5 text-center wrap-anywhere">
      {children}
    </Card.Content>
  )
}

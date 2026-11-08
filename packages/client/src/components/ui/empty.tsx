import { cn } from '@/lib/utils'

import { T } from './typography'

export function Empty({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('py-4 text-center', className)} {...props}>
      <T.muted>Empty</T.muted>
    </div>
  )
}

import { Shapes } from '@/lib/shapes'
import { cn } from '@/lib/utils'

import { MorphingShape } from './morphing-shape'
import { T } from './typography'

export function Empty({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'animate-in fade-in mx-auto flex w-40 max-w-full flex-col items-center justify-center',
        className,
      )}
      {...props}
    >
      <MorphingShape
        shapes={[Shapes.ghostish()]}
        size={300}
        method="press"
        fill="--surface-variant"
        className="w-sm max-w-full"
      />
      <T.muted className="-translate-y-4 text-xl select-none">Empty</T.muted>
    </div>
  )
}

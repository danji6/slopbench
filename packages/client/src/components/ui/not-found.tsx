
import { Shapes } from '@/lib/shapes'

import { MorphingShape } from '.'

export function NotFound() {
  return (
    <div className="animate-in fade-in relative flex h-dvh items-center justify-center">
      <MorphingShape
        shapes={[Shapes.ghostish(), Shapes.circle()]}
        size={500}
        method="press"
        fill="--surface-variant"
        className="w-md max-w-full"
      />
      <h1 className="text-m3-on-surface/80 pointer-events-none absolute inset-0 flex items-center justify-center text-8xl font-bold select-none lg:text-8xl">
        404
      </h1>
    </div>
  )
}

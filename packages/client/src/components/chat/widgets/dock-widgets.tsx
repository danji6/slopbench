import { cn } from '@/lib/utils'

import { SubagentsWidget } from './subagents-widget'
import { TerminalsWidget } from './terminals-widget'
import { TodosWidget } from './todos-widget'

const WIDGET = 'bg-background/80 pointer-events-auto h-9 px-3 backdrop-blur-md'

export function DockWidgets({
  ref,
  className,
}: {
  ref?: React.Ref<HTMLDivElement>
  className?: string
}) {
  // Reserve the row so widgets appearing cannot resize the message list.
  return (
    <div
      ref={ref}
      className={cn(
        'pointer-events-none mb-3 flex h-9 items-center gap-2 px-1',
        className,
      )}
    >
      <TerminalsWidget className={WIDGET} />
      <TodosWidget className={WIDGET} />
      <SubagentsWidget className={WIDGET} />
    </div>
  )
}

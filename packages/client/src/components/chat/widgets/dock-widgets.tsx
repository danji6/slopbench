import { cn } from '@/lib/utils'

import { SubagentsWidget } from './subagents-widget'
import { TerminalsWidget } from './terminals-widget'
import { TodosWidget } from './todos-widget'

const WIDGET = 'bg-background/80 pointer-events-auto h-9 px-3 backdrop-blur-md'

export function DockWidgets({
  ref,
  className,
  actions,
}: {
  ref?: React.Ref<HTMLDivElement>
  className?: string
  actions?: React.ReactNode
}) {
  // Reserve a row even when there are no widgets.
  return (
    <div
      ref={ref}
      data-slot="dock-widgets"
      className={cn(
        'pointer-events-none mb-(--dock-widgets-gap) flex items-center gap-2 px-1',
        actions
          ? 'min-h-(--dock-widgets-height) flex-wrap'
          : 'h-(--dock-widgets-height)',
        className,
      )}
    >
      <TerminalsWidget className={WIDGET} />
      <TodosWidget className={WIDGET} />
      <SubagentsWidget className={WIDGET} />
      {actions && (
        <div className="flex flex-1 items-center justify-between gap-2">
          {actions}
        </div>
      )}
    </div>
  )
}

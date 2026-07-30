import { cn } from '@/lib/utils'

import { SubagentsWidget } from './subagents-widget'
import { TerminalsWidget } from './terminals-widget'
import { TodosWidget } from './todos-widget'

export function DockWidgets({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'mb-1.5 flex items-center justify-end gap-2 px-1 empty:hidden',
        className,
      )}
    >
      <TerminalsWidget className="bg-background/80 h-9 px-3 backdrop-blur-md" />
      <TodosWidget className="bg-background/80 h-9 px-3 backdrop-blur-md" />
      <SubagentsWidget className="bg-background/80 h-9 px-3 backdrop-blur-md" />
    </div>
  )
}

import { Popover } from '@/components/ui/popover'
import { useActiveSessionId } from '@/hooks/chat/session'
import { cn } from '@/lib/utils'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useQuery } from 'convex/react'
import { ListTodoIcon } from 'lucide-react'

import { countCompleted, TodoList } from '../messages/tools/todo-block'

export function TodosWidget({ className }: { className?: string }) {
  const sessionId = useActiveSessionId() as Id<'sessions'> | null
  const todo = useQuery(api.todos.get, sessionId ? { sessionId } : 'skip')

  const items = todo?.items ?? []
  if (items.length === 0) return null

  const done = countCompleted(items)

  return (
    <Popover>
      <Popover.Trigger
        className={cn(
          'text-muted-foreground hover:text-foreground focus-visible:ring-ring flex h-full cursor-pointer items-center gap-1 rounded-full px-2 outline-0 transition-colors focus-visible:ring-1',
          className,
        )}
        aria-label={`${done} of ${items.length} todos done`}
      >
        <ListTodoIcon className="size-4" />
        <span className="text-xs tabular-nums">
          {done}/{items.length}
        </span>
      </Popover.Trigger>
      <Popover.Content align="end" className="w-72">
        <Popover.Header>
          <Popover.Title>Todos</Popover.Title>
          <Popover.Description>
            {done} of {items.length} done
          </Popover.Description>
        </Popover.Header>

        <TodoList items={items} />
      </Popover.Content>
    </Popover>
  )
}

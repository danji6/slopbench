import { cn } from '@/lib/utils'
import { TODO_EDIT_STATUSES, type TodoEditStatus } from '@sb/core/const'
import type { TodoItem, TodoStatus } from '@sb/convex/types'
import type { ToolUIPart } from 'ai'
import type { LucideIcon } from 'lucide-react'
import { CircleCheckIcon, CircleDotIcon, CircleIcon } from 'lucide-react'

import { ToolShell } from './tool-shell'

const STATUS_ICONS: Record<TodoStatus, LucideIcon> = {
  pending: CircleIcon,
  in_progress: CircleDotIcon,
  completed: CircleCheckIcon,
}

export function countCompleted(items: TodoItem[]) {
  return items.filter((item) => item.status === 'completed').length
}

/** Compact todo checklist, shared by the tool block and the live widget. */
export function TodoList({
  items,
  className,
}: {
  items: TodoItem[]
  className?: string
}) {
  return (
    <ul className={cn('flex flex-col gap-1', className)}>
      {items.map((item, index) => {
        const Icon = STATUS_ICONS[item.status]
        const completed = item.status === 'completed'
        return (
          <li key={index} className="flex items-start gap-1.5 text-xs">
            <Icon
              className={cn(
                'mt-px size-3.5 shrink-0',
                completed
                  ? 'text-muted-foreground'
                  : item.status === 'in_progress' && 'text-primary',
              )}
            />
            <span
              className={cn(completed && 'text-muted-foreground line-through')}
            >
              {item.content}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

type TodoBlockProps = {
  part: ToolUIPart
  messageId: string
  forceError?: boolean
}

function TodoToolShell({
  items,
  label,
  ...props
}: TodoBlockProps & { items: TodoItem[]; label: string }) {
  return (
    <ToolShell
      data-slot="todo-block"
      {...props}
      dense
      label={
        <span className="text-foreground font-medium">
          {label}
          {items.length > 0 && (
            <span className="text-muted-foreground font-normal">
              {' '}
              ({items.length})
            </span>
          )}
        </span>
      }
    >
      {items.length > 0 && <TodoList items={items} />}
    </ToolShell>
  )
}

export function WriteTodoBlock(props: TodoBlockProps) {
  const todos = (props.part.input as { todos?: string[] } | undefined)?.todos
  const items = (todos ?? []).map((content) => ({
    content,
    status: 'pending' as TodoStatus,
  }))

  return (
    <TodoToolShell
      {...props}
      items={items}
      label={items.length === 0 ? 'Clear todos' : 'Write todos'}
    />
  )
}

type TodoEditInput = { task?: string; status?: TodoEditStatus }

export function EditTodoBlock(props: TodoBlockProps) {
  const edits = (props.part.input as { edits?: TodoEditInput[] } | undefined)
    ?.edits
  const items = (edits ?? []).map((edit) => ({
    content: edit.task ?? '',
    status: TODO_EDIT_STATUSES[edit.status ?? 'todo'] ?? 'pending',
  }))

  return <TodoToolShell {...props} items={items} label="Update todos" />
}

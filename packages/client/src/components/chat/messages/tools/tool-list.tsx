import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

type ToolListProps = {
  children: ReactNode
  className?: string
}

/** Draws the shared tree layout for grouped tool calls. */
export function ToolList({ children, className }: ToolListProps) {
  return (
    <ul
      className={cn(
        'before:bg-border relative ml-4 flex flex-col gap-(--tool-list-gap) pl-3 [--tool-list-gap:var(--work-row-gap)] before:absolute before:top-0 before:left-0 before:h-2 before:w-px',
        className,
      )}
    >
      {children}
    </ul>
  )
}

export function ToolListItem({
  last,
  children,
}: {
  last: boolean
  children: ReactNode
}) {
  return (
    <li
      className={cn(
        'before:bg-border relative min-w-0 text-xs before:absolute before:top-2 before:-left-3 before:h-px before:w-2.5',
        !last &&
          'after:bg-border after:absolute after:top-2 after:-bottom-[calc(var(--tool-list-gap)+var(--spacing)*2)] after:-left-3 after:w-px',
      )}
    >
      {children}
    </li>
  )
}

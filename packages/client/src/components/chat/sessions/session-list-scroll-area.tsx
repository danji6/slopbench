import type { ReactNode } from 'react'

type SessionListScrollAreaProps = {
  children: ReactNode
}

/** Scrolls folders and unfiled sessions without accepting background drops. */
export function SessionListScrollArea({
  children,
}: SessionListScrollAreaProps) {
  return (
    <div
      data-slot="session-list-scroll-area"
      className="min-h-0 flex-1 overflow-y-auto px-2"
    >
      {children}
    </div>
  )
}

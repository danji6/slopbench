import type { GroupRow } from '@/lib/chat/session-groups'
import { useDndContext, useDroppable } from '@dnd-kit/core'
import { type ReactElement, useCallback, useRef } from 'react'
import { Virtualizer } from 'virtua'

export const SESSION_LIST_BACKGROUND_TARGET = 'session-list-background'

type SessionListScrollAreaProps = {
  rows: GroupRow[]
  renderRow: (row: GroupRow, index: number) => ReactElement
  searching: boolean
  pending: boolean
}

/** Accepts unfiled session drops in the space below the virtualized list. */
export function SessionListScrollArea({
  rows,
  renderRow,
  searching,
  pending,
}: SessionListScrollAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { active } = useDndContext()

  const { setNodeRef } = useDroppable({
    id: SESSION_LIST_BACKGROUND_TARGET,
    data: { groupKey: 'ungrouped' },
    disabled: searching || pending || active?.data.current?.kind !== 'session',
  })

  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node
      setNodeRef(node)
    },
    [setNodeRef],
  )

  return (
    <div ref={attach} className="min-h-0 flex-1 overflow-y-auto px-2">
      <Virtualizer scrollRef={scrollRef} data={rows}>
        {renderRow}
      </Virtualizer>
    </div>
  )
}

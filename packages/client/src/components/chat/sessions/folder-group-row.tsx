import type { GroupRow } from '@/lib/chat/session-groups'
import { cn } from '@/lib/utils'
import { useDndContext, useDroppable } from '@dnd-kit/core'
import type { ReactNode } from 'react'

type FolderGroupRowProps = {
  row: GroupRow
  last: boolean
  hasSources: boolean
  children: ReactNode
}

/** Treats each virtualized row as part of its folder's drop surface. */
export function FolderGroupRow({
  row,
  last,
  hasSources,
  children,
}: FolderGroupRowProps) {
  const { active, over } = useDndContext()
  const draggingSession = active?.data.current?.kind === 'session'
  const disabled = !draggingSession || (active?.data.current?.owned === false && hasSources) // prettier-ignore
  const highlighted = !disabled && over?.data.current?.groupKey === row.key
  const first = row.kind === 'header'

  const { setNodeRef } = useDroppable({
    id: `folder-drop:${row.key}:${row.kind === 'session' ? row.id : row.kind}`,
    data: { groupKey: row.key },
    disabled,
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'border-x border-transparent',
        first && 'mt-2 rounded-t-md border-t',
        last && 'rounded-b-md border-b',
        highlighted && 'border-primary bg-primary/15',
      )}
    >
      {children}
    </div>
  )
}

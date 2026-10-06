import { folderDropAppearance } from '@/lib/chat/folder-moves'
import type { GroupRow } from '@/lib/chat/session-groups'
import { cn } from '@/lib/utils'
import { useDndContext, useDroppable } from '@dnd-kit/core'
import type { ReactNode } from 'react'

type FolderGroupRowProps = {
  row: GroupRow
  last: boolean
  hasSources: boolean
  children: ReactNode
  pending?: boolean
}

/** Treats each virtualized row as part of its folder's drop surface. */
export function FolderGroupRow({
  row,
  last,
  hasSources,
  children,
  pending,
}: FolderGroupRowProps) {
  const { active, over } = useDndContext()
  const draggingSession = active?.data.current?.kind === 'session'
  const draggingFolder = active?.data.current?.kind === 'folder'
  const first = row.kind === 'header'

  const ownBranch =
    active?.id === row.key || row.ancestorIds?.includes(String(active?.id))

  const folderBody =
    draggingFolder && !first && Boolean(row.ancestorIds) && !ownBranch

  const disabled =
    pending ||
    (!draggingSession && !folderBody) ||
    (draggingSession && active?.data.current?.owned === false && hasSources)

  const folderTarget =
    draggingFolder && over?.data.current?.kind === 'folder-target'
      ? over.data.current
      : undefined

  const sessionTarget = over?.data.current?.groupKey as string | undefined

  const target =
    folderTarget ??
    (draggingSession && !disabled && sessionTarget
      ? { folderId: sessionTarget, placement: 'inside' as const }
      : undefined)

  const appearance = folderDropAppearance(
    { ...row, last },
    pending
      ? undefined
      : (target as Parameters<typeof folderDropAppearance>[1]),
  )

  const { setNodeRef } = useDroppable({
    id: `folder-drop:${row.key}:${row.kind === 'session' ? row.id : row.kind}`,
    data: folderBody
      ? { kind: 'folder-target', folderId: row.key, placement: 'after' }
      : { groupKey: row.key },
    disabled,
  })

  return (
    <div
      className={cn('relative', first && 'pt-2')}
      style={{ paddingInlineStart: Math.min(row.depth ?? 0, 4) * 12 }}
    >
      {appearance.highlighted && (
        <div
          className={cn(
            'border-primary bg-primary/15 pointer-events-none absolute right-0 bottom-0 border-x',
            appearance.first ? 'top-2 rounded-t-md border-t' : 'top-0',
            appearance.last && 'rounded-b-md border-b',
          )}
          style={{ left: Math.min(Math.max(appearance.depth, 0), 4) * 12 }}
        />
      )}
      <div
        ref={setNodeRef}
        className={cn(
          'relative border-x border-transparent',
          first && 'rounded-t-md border-t',
          last && 'rounded-b-md border-b',
        )}
      >
        {children}
      </div>
      {(appearance.lineBefore || appearance.lineAfter) && (
        <div
          className={cn(
            'border-primary pointer-events-none absolute right-0 z-20 border-t-2',
            appearance.lineBefore ? 'top-2' : 'bottom-0',
          )}
          style={{ left: Math.min(Math.max(appearance.depth, 0), 4) * 12 }}
        />
      )}
    </div>
  )
}

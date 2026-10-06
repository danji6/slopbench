import type { FolderDropPlacement } from '@/lib/chat/folder-moves'
import { cn } from '@/lib/utils'
import { useDndContext, useDroppable } from '@dnd-kit/core'
import type { FolderView } from '@sb/convex/types'

/** Gives folder headers separate insertion edges and a nesting center. */
export function FolderDropTargets({ folder }: { folder: FolderView }) {
  return (
    <>
      <FolderDropZone folder={folder} placement="before" />
      <FolderDropZone folder={folder} placement="inside" />
      <FolderDropZone folder={folder} placement="after" />
    </>
  )
}

function FolderDropZone({
  folder,
  placement,
}: {
  folder: FolderView
  placement: FolderDropPlacement
}) {
  const { active } = useDndContext()
  const ownBranch =
    active?.id === folder._id || folder.ancestorIds.includes(String(active?.id))
  const disabled = active?.data.current?.kind !== 'folder' || ownBranch

  const { setNodeRef } = useDroppable({
    id: `folder-zone:${folder._id}:${placement}`,
    data: { kind: 'folder-target', folderId: folder._id, placement },
    disabled,
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'pointer-events-none absolute inset-x-0 z-10',
        placement === 'before'
          ? 'top-0 h-1/4'
          : placement === 'after'
            ? 'bottom-0 h-1/4'
            : 'top-1/4 h-1/2',
      )}
    />
  )
}

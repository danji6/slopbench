import { Dialog, RippleButton } from '@/components/ui'
import { useIsAdmin } from '@/hooks/chat'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { FolderMoveArgs, FolderView } from '@sb/convex/types'
import { useQuery } from 'convex/react'
import { useState } from 'react'

import { FolderPicker } from './folder-picker'

type FolderMoveDialogProps = {
  folder: FolderView
  intent: FolderMoveArgs
  chooseParent: boolean
  onMove: (input: FolderMoveArgs) => Promise<void>
  onClose: () => void
}

export function FolderMoveDialog({
  folder,
  intent,
  chooseParent,
  onMove,
  onClose,
}: FolderMoveDialogProps) {
  const [parentId, setParentId] = useState<string | null>(intent.parentId)

  const input = {
    ...intent,
    parentId: parentId as Id<'sessionFolders'> | null,
    beforeFolderId:
      parentId === intent.parentId ? intent.beforeFolderId : undefined,
  }

  const preview = useQuery(api.sessionFolders.previewMove, input)
  const isAdmin = useIsAdmin()
  const canMove = Boolean(preview?.ok && (!preview.requiresAdmin || isAdmin))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Move folder</Dialog.Title>
          <Dialog.Description>
            Move {folder.folderPath} and all its subfolders.
          </Dialog.Description>
        </Dialog.Header>
        {chooseParent && (
          <FolderPicker
            value={parentId}
            onChange={setParentId}
            rootLabel="Top level"
            label="Parent folder"
            excludeBranchId={folder._id}
          />
        )}
        <div className="flex flex-col gap-2 text-sm">
          {!preview ? (
            <p>Checking folder…</p>
          ) : !preview.ok ? (
            <p className="text-destructive">{preview.message}</p>
          ) : (
            <>
              <p>
                {preview.affectedSessions} owned session
                {preview.affectedSessions === 1 ? '' : 's'} in this branch.
              </p>
              {preview.needsConfirmation && (
                <p>
                  These sessions will use{' '}
                  {parentId
                    ? `the sources inherited from ${preview.sourceLabel ?? 'the destination folder'}`
                    : 'an independent copy of the current sources'}
                  .
                </p>
              )}
              {preview.sources.map((source) => (
                <p key={source.id} className="text-muted-foreground break-all">
                  {source.path}
                </p>
              ))}
              {!preview.sources.length && (
                <p className="text-muted-foreground">
                  No folder-provided filesystem access.
                </p>
              )}
              {!folder.parentId && folder.sources.length > 0 && parentId && (
                <p>
                  This replaces this folder’s own source configuration with
                  inherited sources.
                </p>
              )}
              {preview.requiresAdmin && !isAdmin && (
                <p className="text-destructive">
                  An administrator must make this source configuration change.
                </p>
              )}
            </>
          )}
        </div>
        <Dialog.Footer>
          <RippleButton variant="surface" onClick={onClose}>
            Cancel
          </RippleButton>
          <RippleButton
            variant="primary"
            disabled={!canMove}
            onClick={() =>
              void onMove({
                ...input,
                confirmationKey: preview?.ok
                  ? preview.confirmationKey
                  : undefined,
              })
            }
          >
            Move folder
          </RippleButton>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  )
}

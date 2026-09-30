import { Dialog, RippleButton } from '@/components/ui'
import { toastError } from '@/lib/notifications'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useAction } from 'convex/react'
import { useState } from 'react'

import { FolderPicker } from './folder-picker'

export function SessionFolderDialog({
  sessionId,
  folderId,
  onClose,
}: {
  sessionId: Id<'sessions'>
  folderId?: string
  onClose: () => void
}) {
  const [selected, setSelected] = useState<string | null>(folderId ?? null)
  const [busy, setBusy] = useState(false)
  const change = useAction(api.actions.folders.change)
  async function move() {
    setBusy(true)
    try {
      await change({
        sessionId,
        folderId: (selected as Id<'sessionFolders'> | undefined) || undefined,
      })
      onClose()
    } catch (err) {
      toastError(err, 'Could not move session')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Move session</Dialog.Title>
        </Dialog.Header>
        <p className="text-muted-foreground py-3 text-sm">
          The session will use the selected folder’s source directories.
        </p>
        <FolderPicker value={selected} onChange={setSelected} disabled={busy} />
        <Dialog.Footer>
          <RippleButton variant="surface" onClick={onClose} disabled={busy}>
            Cancel
          </RippleButton>
          <RippleButton
            variant="primary"
            onClick={() => void move()}
            disabled={busy}
          >
            Move
          </RippleButton>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  )
}

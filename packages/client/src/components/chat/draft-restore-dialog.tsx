import { ConfirmDialog } from '@/components/ui'
import { draftRestore, usePendingDraftRestore } from '@/lib/chat/draft-restore'
import { useState } from 'react'

/** Asks before an editor recovers an unsaved draft. */
export function DraftRestoreDialog() {
  const pending = usePendingDraftRestore()

  const [label, setLabel] = useState('')
  if (pending && pending.label !== label) setLabel(pending.label)

  return (
    <ConfirmDialog
      open={pending !== undefined}
      onOpenChange={(open) => {
        if (!open && pending) draftRestore.dismiss(pending)
      }}
      title="Restore unsaved changes?"
      description={`Unsaved changes to ${label} were recovered. Discarding them cannot be undone.`}
      confirmText="Restore"
      cancelText="Discard"
      onConfirm={() => pending && draftRestore.restore(pending)}
      onCancel={() => pending && draftRestore.discard(pending)}
      // Above every editor, including a fullscreen one
      layer={60}
    />
  )
}

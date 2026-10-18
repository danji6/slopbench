import { ConfirmDialog } from '@/components/ui'
import { api } from '@sb/convex/_generated/api'
import { useQuery } from 'convex/react'

import type { SkillListItem } from './skill-list'

type LibraryDeletionDialogProps = {
  item: SkillListItem
  busy: boolean
  onClose: () => void
  onDelete: (mode: 'delete-all' | 'keep-copies') => void
}

/** Presents affected agents and both library removal choices. */
export function LibraryDeletionDialog({
  item,
  busy,
  onClose,
  onDelete,
}: LibraryDeletionDialogProps) {
  const preview = useQuery(api.skills.deletionPreview, { skillId: item._id })
  const blocked = busy || !preview || preview.blockers.length > 0
  const agentNames = preview?.homes
    .flatMap((home) => home.agents.map((agent) => agent.name))
    .join(', ')
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Delete ${item.name} from the library?`}
      description={
        <>
          <span className="block">
            You can choose to delete all assigned copies of this skill, or keep
            them and only delete the original skill bundle.
          </span>
          {preview === null ? (
            <span role="status" className="mt-2 block">
              This library skill has already been deleted.
            </span>
          ) : !preview ? (
            <span role="status" className="mt-2 block">
              Checking affected agents…
            </span>
          ) : (
            <span className="mt-2 block max-h-48 overflow-y-auto wrap-anywhere">
              <span className="block">Affected agents:</span>
              {agentNames || 'None'}
              {preview.blockers.length > 0 && (
                <span
                  role="alert"
                  className="text-destructive block whitespace-pre-line"
                >
                  {preview.blockers.join('\n')}
                </span>
              )}
            </span>
          )}
        </>
      }
      confirmText="Delete all"
      confirmDisabled={blocked}
      variant="destructive"
      onConfirm={() => onDelete('delete-all')}
      extraAction={{
        text: 'Keep copies',
        variant: 'input',
        disabled: blocked,
        onConfirm: () => onDelete('keep-copies'),
      }}
    />
  )
}

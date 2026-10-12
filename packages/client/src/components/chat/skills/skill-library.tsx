import { ConfirmDialog, SearchInput } from '@/components/ui'
import { useAgentFileOperation, useSkillPagination } from '@/hooks/chat/skills'
import { useIsAdmin } from '@/hooks/chat/tools'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useQuery } from 'convex/react'
import { useState } from 'react'

import { FileOperationStatus } from './operation-status'
import { SkillImport } from './skill-import'
import { SkillList, SkillPageControls } from './skill-list'
import type { SkillListItem } from './skill-list'

export function SkillLibrary({ agentId }: { agentId?: Id<'agents'> }) {
  const admin = useIsAdmin()
  const operation = useAgentFileOperation(agentId ?? 'library')
  const pagination = useSkillPagination()
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState<SkillListItem>()

  const page = useQuery(
    api.skills.list,
    admin
      ? { search, paginationOpts: { cursor: pagination.cursor, numItems: 20 } }
      : 'skip',
  )

  if (!admin) {
    return (
      <p className="text-muted-foreground p-4 text-sm">
        Personal files and skills are available to administrators.
      </p>
    )
  }

  function choose(item: SkillListItem) {
    if (agentId) {
      void operation.run({
        kind: 'assign',
        agentId,
        skillId: item._id as Id<'skills'>,
      })
    } else {
      setDeleting(item)
    }
  }

  return (
    <div className="space-y-4 p-4">
      {!agentId && <SkillImport operation={operation} />}
      <SearchInput
        aria-label="Search skill names"
        placeholder="Search skill names…"
        value={search}
        onValueChange={(value) => {
          setSearch(value)
          pagination.reset()
        }}
      />
      <FileOperationStatus operation={operation} />
      {!page ? (
        <p role="status">Loading skills…</p>
      ) : (
        <>
          <SkillList
            items={page.page}
            actionLabel={agentId ? 'Add' : 'Delete'}
            busy={operation.busy}
            onAction={choose}
          />
          <SkillPageControls
            canBack={pagination.canBack}
            back={pagination.back}
            isDone={page.isDone}
            next={() => pagination.next(page.continueCursor)}
          />
        </>
      )}
      {agentId && (
        <p className="text-muted-foreground text-sm">
          Adding creates a separate editable copy. Changes apply immediately.
        </p>
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(undefined)}
        title="Delete library skill?"
        description="The pristine bundle will be deleted. Remove its agent assignments first."
        confirmText="Delete"
        variant="destructive"
        onConfirm={() =>
          deleting &&
          void operation.run({
            kind: 'delete-library',
            skillId: deleting._id as Id<'skills'>,
          })
        }
      />
    </div>
  )
}

import { ConfirmDialog, SearchInput } from '@/components/ui'
import { useHomeOperation } from '@/hooks/chat/skills'
import { useIsAdmin } from '@/hooks/chat/tools'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { usePaginatedQuery } from 'convex/react'
import { useState } from 'react'

import { FileOperationStatus } from './operation-status'
import { SkillImport } from './skill-import'
import { SkillList } from './skill-list'
import type { SkillListItem } from './skill-list'

export function SkillLibrary({ agentId }: { agentId?: Id<'agents'> }) {
  const admin = useIsAdmin()
  const { operation } = useHomeOperation(agentId)
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState<SkillListItem>()

  const page = usePaginatedQuery(
    api.skills.list,
    admin ? { search, agentId } : 'skip',
    { initialNumItems: 20 },
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
        }}
      />
      {!agentId && <FileOperationStatus operation={operation} />}
      <SkillList
        items={page.results}
        status={page.status}
        loadMore={page.loadMore}
        actionLabel={agentId ? 'Add' : 'Delete'}
        busy={operation.busy}
        onAction={choose}
      />
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

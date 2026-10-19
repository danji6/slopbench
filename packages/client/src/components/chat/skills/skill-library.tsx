import {
  ConfirmDialog,
  DropdownMenu,
  RippleButton,
  SearchInput,
} from '@/components/ui'
import { useHomeOperation, useSkillToggle } from '@/hooks/chat/skills'
import { useIsAdmin } from '@/hooks/chat/tools'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { usePaginatedQuery } from 'convex/react'
import { ListFilterIcon } from 'lucide-react'
import { useState } from 'react'

import { LibraryDeletionDialog } from './library-deletion-dialog'
import { FileOperationStatus } from './operation-status'
import { SkillImport } from './skill-import'
import { SkillList } from './skill-list'
import type { SkillListItem } from './skill-list'
import { SkillVerification } from './skill-verification'

type AssignmentFilter = 'all' | 'added' | 'not-added'

export function SkillLibrary({ agentId }: { agentId?: Id<'agents'> }) {
  const admin = useIsAdmin()
  const { operation, home } = useHomeOperation(agentId)
  const toggle = useSkillToggle(agentId)
  const [search, setSearch] = useState('')
  const [assignment, setAssignment] = useState<AssignmentFilter>('all')
  const [deleting, setDeleting] = useState<SkillListItem>()

  const page = usePaginatedQuery(
    api.skills.list,
    admin
      ? {
          search,
          agentId,
          assignment: assignment === 'all' ? undefined : assignment,
        }
      : 'skip',
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
      void operation.run({ kind: 'assign', agentId, skillId: item._id })
    } else {
      setDeleting(item)
    }
  }

  function confirmDelete() {
    if (!deleting) return
    if (agentId && deleting.assignmentId) {
      void operation.run({
        kind: 'delete-assigned',
        agentId,
        assignmentId: deleting.assignmentId,
      })
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden p-4">
      <div className="shrink-0 space-y-4">
        {!agentId && <SkillImport operation={operation} />}
        {agentId && home && home.members.length > 1 && (
          <p className="text-muted-foreground text-sm">
            This folder and its skills are shared with{' '}
            {home.members
              .filter((member) => member.id !== agentId)
              .map((member) => member.name)
              .join(', ')}
            . Changes affect every agent using it.
          </p>
        )}
        <div className="flex items-center gap-2">
          <SearchInput
            className="h-9 min-w-0 flex-1"
            aria-label="Search skill names"
            placeholder="Search skill names…"
            value={search}
            onValueChange={setSearch}
          />
          {agentId && (
            <SkillFilter value={assignment} onValueChange={setAssignment} />
          )}
        </div>
        {!agentId && <SkillVerification disabled={operation.busy} />}
        <FileOperationStatus operation={operation} />
        {toggle.error && (
          <p role="alert" className="text-destructive text-sm">
            {toggle.error}
          </p>
        )}
      </div>
      <SkillList
        key={JSON.stringify([search, assignment])}
        className="max-h-none min-h-0 flex-1"
        items={page.results}
        status={page.status}
        loadMore={page.loadMore}
        actionLabel={agentId ? 'Add' : 'Delete'}
        busy={operation.busy || toggle.saving}
        onAction={choose}
        onRemove={agentId ? setDeleting : undefined}
        onToggle={
          agentId
            ? (item, enabled) => {
                if (item.assignmentId)
                  void toggle.setEnabled(item.assignmentId, enabled)
              }
            : undefined
        }
      />
      {!agentId && deleting && (
        <LibraryDeletionDialog
          item={deleting}
          busy={operation.busy}
          onClose={() => setDeleting(undefined)}
          onDelete={(mode) => {
            void operation.run({
              kind: 'delete-library',
              skillId: deleting._id,
              mode,
            })
            setDeleting(undefined)
          }}
        />
      )}
      <ConfirmDialog
        open={!!agentId && !!deleting}
        onOpenChange={(open) => !open && setDeleting(undefined)}
        title={agentId ? 'Delete this agent’s skill?' : 'Delete library skill?'}
        description={
          agentId
            ? 'Any edits the agent has done to this skill will be permanently lost.'
            : 'This action cannot be undone.'
        }
        confirmText="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </div>
  )
}

type SkillFilterProps = {
  value: AssignmentFilter
  onValueChange: (value: AssignmentFilter) => void
}

function SkillFilter({ value, onValueChange }: SkillFilterProps) {
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger
        render={
          <RippleButton
            variant={value === 'all' ? 'input' : 'secondary'}
            className="shrink-0"
          />
        }
      >
        <ListFilterIcon />
        Filter
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.RadioGroup
          value={value}
          onValueChange={(next) => onValueChange(next as AssignmentFilter)}
        >
          <DropdownMenu.RadioItem value="all" closeOnClick>
            All skills
          </DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem value="added" closeOnClick>
            Added
          </DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem value="not-added" closeOnClick>
            Not added
          </DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu>
  )
}

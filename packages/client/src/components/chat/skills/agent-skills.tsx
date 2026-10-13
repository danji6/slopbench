import { ConfirmDialog } from '@/components/ui'
import { useHomeOperation } from '@/hooks/chat/skills'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { usePaginatedQuery } from 'convex/react'
import { useState } from 'react'

import { AgentFileAccess } from './agent-file-access'
import { FileOperationStatus } from './operation-status'
import { SkillLibrary } from './skill-library'
import { SkillList } from './skill-list'
import type { SkillListItem } from './skill-list'

export function AgentSkills({ agentId }: { agentId?: Id<'agents'> }) {
  return (
    <AgentFileAccess agentId={agentId}>
      {(id) => (
        <>
          <AssignedSkills agentId={id} />
          <h3 className="px-4 pt-4 font-medium">Add from library</h3>
          <SkillLibrary agentId={id} />
        </>
      )}
    </AgentFileAccess>
  )
}

function AssignedSkills({ agentId }: { agentId: Id<'agents'> }) {
  const [deleting, setDeleting] = useState<SkillListItem>()
  const { operation, home } = useHomeOperation(agentId)
  const page = usePaginatedQuery(
    api.skills.assigned,
    { agentId },
    { initialNumItems: 20 },
  )

  return (
    <div className="space-y-3 p-4">
      <h3 className="font-medium">Assigned skills</h3>
      {home && home.members.length > 1 && (
        <p className="text-muted-foreground text-sm">
          This folder and its skills are shared with{' '}
          {home.members
            .filter((member) => member.id !== agentId)
            .map((member) => member.name)
            .join(', ')}
          . Changes affect every agent using it.
        </p>
      )}
      <FileOperationStatus operation={operation} />
      <SkillList
        items={page.results}
        status={page.status}
        loadMore={page.loadMore}
        actionLabel="Remove"
        busy={operation.busy}
        onAction={setDeleting}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(undefined)}
        title="Delete this agent’s skill?"
        description="Any edits the agent has done to this skill will be permanently lost."
        confirmText="Delete"
        variant="destructive"
        onConfirm={() =>
          deleting &&
          void operation.run({
            kind: 'delete-assigned',
            agentId,
            assignmentId: deleting._id as Id<'agentSkills'>,
          })
        }
      />
    </div>
  )
}

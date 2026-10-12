import { ConfirmDialog } from '@/components/ui'
import { useAgentFileOperation, useSkillPagination } from '@/hooks/chat/skills'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useQuery } from 'convex/react'
import { useState } from 'react'

import { AgentFileAccess } from './agent-file-access'
import { FileOperationStatus } from './operation-status'
import { SkillLibrary } from './skill-library'
import { SkillList, SkillPageControls } from './skill-list'
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
  const operation = useAgentFileOperation(`assigned:${agentId}`)
  const pagination = useSkillPagination()
  const page = useQuery(api.skills.assigned, {
    agentId,
    paginationOpts: { cursor: pagination.cursor, numItems: 20 },
  })
  const [deleting, setDeleting] = useState<SkillListItem>()
  return (
    <div className="space-y-3 p-4">
      <h3 className="font-medium">Assigned skills</h3>
      <p className="text-muted-foreground text-sm">
        This agent can customize its copies. Delete a copy and add it again to
        restore the pristine library version.
      </p>
      <FileOperationStatus operation={operation} />
      {page && (
        <>
          <SkillList
            items={page.page}
            actionLabel="Remove"
            busy={operation.busy}
            onAction={setDeleting}
          />
          <SkillPageControls
            canBack={pagination.canBack}
            back={pagination.back}
            isDone={page.isDone}
            next={() => pagination.next(page.continueCursor)}
          />
        </>
      )}
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

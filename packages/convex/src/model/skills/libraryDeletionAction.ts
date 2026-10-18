'use node'

import { internal } from '../../_generated/api'
import type { ActionCtx } from '../../_generated/server'
import { postSidecar } from '../sidecar'
import type { ExecutionContext } from './execution'

type DeletionContext = Extract<ExecutionContext, { kind: 'delete-library' }>

/** Deletes assigned copies durably before removing their library source. */
export async function deleteLibrary(ctx: ActionCtx, data: DeletionContext) {
  const op = data.operation
  if (op.mode === 'delete-all') {
    for (const { assignment, home } of data.targets) {
      await postSidecar('/agent-files/operation', {
        id: `${op._id}-${op.attempt}-${assignment._id}`,
        kind: 'delete-assigned',
        ownerId: op.ownerId,
        agentId: home.originAgentId,
        originAgentId: home.originAgentId,
        homeId: home._id,
        homePath: home.path,
        name: assignment.name,
      })
      await ctx.runMutation(internal.skills._removeDeletedAssignment, {
        operationId: op._id,
        attempt: op.attempt,
        assignmentId: assignment._id,
      })
    }
  }
  await postSidecar('/agent-files/operation', {
    id: op._id,
    kind: 'delete-library',
    ownerId: op.ownerId,
    skillId: op.skillId,
  })
}

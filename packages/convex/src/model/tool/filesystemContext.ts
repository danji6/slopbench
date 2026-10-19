import type { QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import { minRole } from '../../lib/roles'
import type { StreamExecutionArgs } from '../../types'
import { getSessionWithWorkspace } from '../session/folderContext'
import { requireEnabled } from '../session/memberships'
import { agentWithHome } from '../skills/homes'
import { ownsExecution } from '../stream/execution'

/** Rechecks the live invoker and workspace before exposing filesystem tools. */
export async function filesystemToolContext(
  ctx: QueryCtx,
  execution: StreamExecutionArgs,
) {
  const stream = await ctx.db.get(execution.streamId)
  if (!ownsExecution(stream, execution))
    error('Filesystem invocation is no longer active', 409)

  const user = await ctx.db.get(stream.invokedBy)
  if (!user || !minRole(user.role, 'admin')) error('Forbidden', 403)

  const session = await getSessionWithWorkspace(ctx, stream.sessionId)
  const agent = await agentWithHome(ctx, stream.agentId)

  if (!session || !agent) error('Not found', 404)
  requireEnabled(session)
  if (agent.fileOperationId || agent.home?.operationId)
    error('Personal folder is being updated', 409)

  return { agent, workspace: session.workspace }
}

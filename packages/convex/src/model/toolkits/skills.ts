import type { QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import { requireRole } from '../../functions'
import type { StreamExecutionArgs, ToolkitSkillReadArgs } from '../../types'
import { requireExecution } from '../mcpOperationAccess'
import { hasInvocationAccess } from '../mcpRuntime'
import { getSessionWithWorkspace } from '../session/folderContext'
import { requireEnabled } from '../session/memberships'
import { filesystemToolContext } from '../tool/filesystemContext'
import { availableToolkits } from './access'

/** Resolves a toolkit skill through current session, role and component policy. */
export async function skillAccess(ctx: QueryCtx, args: ToolkitSkillReadArgs) {
  const stream = await requireExecution(ctx, args)
  const invoker = await ctx.db.get(stream.invokedBy)

  requireRole(invoker?.role, 'admin')
  if (!(await hasInvocationAccess(ctx, stream.sessionId, stream.invokedBy)))
    error('Skill access revoked', 403)

  const session = await getSessionWithWorkspace(ctx, stream.sessionId)
  if (!session) error('Skill session unavailable', 404)
  requireEnabled(session)

  const { toolkitId, name, resource, offset, length } = args
  const rows = await availableToolkits(ctx, stream.agentId, stream.sessionId)
  const row = rows.find((row) => row._id === toolkitId)
  if (!row?.skillsEnabled || row.disabledSkills.includes(name))
    error('Toolkit skill unavailable', 403)

  return {
    root: row.root,
    revision: row.revision,
    name,
    resource,
    offset,
    length,
  }
}

export async function skillContext(ctx: QueryCtx, args: StreamExecutionArgs) {
  const stream = await requireExecution(ctx, args)
  if (!(await hasInvocationAccess(ctx, stream.sessionId, stream.invokedBy)))
    error('Skill access revoked', 403)
  return {
    ...(await filesystemToolContext(ctx, args)),
    sessionId: stream.sessionId,
  }
}

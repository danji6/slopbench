import { parseIntegrationSkillUri } from '@sb/core/types/integration'

import type { QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import { requireRole } from '../../functions'
import type { IntegrationSkillReadArgs, StreamExecutionArgs } from '../../types'
import { requireExecution } from '../mcpOperationAccess'
import { hasInvocationAccess } from '../mcpRuntime'
import { getSessionWithWorkspace } from '../session/folderContext'
import { requireEnabled } from '../session/memberships'
import { filesystemToolContext } from '../tool/filesystemContext'
import { availableIntegrations } from './access'

/** Resolves a read-only URI through current session, role and component policy. */
export async function skillAccess(
  ctx: QueryCtx,
  args: IntegrationSkillReadArgs,
) {
  const stream = await requireExecution(ctx, args)
  const invoker = await ctx.db.get(stream.invokedBy)

  requireRole(invoker?.role, 'admin')
  if (!(await hasInvocationAccess(ctx, stream.sessionId, stream.invokedBy)))
    error('Skill access revoked', 403)

  const session = await getSessionWithWorkspace(ctx, stream.sessionId)
  if (!session) error('Skill session unavailable', 404)
  requireEnabled(session)

  const uri = parseIntegrationSkillUri(args.uri)
  if (!uri) error('Invalid integration skill URI', 400)

  const rows = await availableIntegrations(
    ctx,
    stream.agentId,
    stream.sessionId,
  )
  const row = rows.find((row) => row._id === uri.integrationId)
  if (!row?.skillsEnabled || row.disabledSkills.includes(uri.name))
    error('Integration skill unavailable', 403)

  return {
    root: row.root,
    revision: row.revision,
    name: uri.name,
    resource: uri.resource,
    offset: args.offset,
    length: args.length,
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

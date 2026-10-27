import {
  TOOL_CAPABILITIES,
  selectedBuiltinTools,
} from '@sb/core/tool-capabilities'

import type { Doc, Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import { minRole } from '../../lib/roles'
import { getBySessionAgent } from '../session/cache'

/** Uses the chat's frozen selection until reset, retaining live role checks. */
export async function sessionToolNames(
  ctx: QueryCtx,
  sessionId: Id<'sessions'>,
  agent: Doc<'agents'>,
  invokerId: Id<'users'>,
) {
  const user = await ctx.db.get(invokerId)
  const cache = await getBySessionAgent(
    ctx,
    sessionId,
    agent._id,
    minRole(user?.role, 'admin'),
  )
  if (cache?.tools) return cache.tools.names
  const admin = minRole(user?.role, 'admin')
  const selected = agent.tools?.filter((name) => {
    const row = TOOL_CAPABILITIES.find((row) => row.name === name)
    return row && (!('requiresAdmin' in row) || admin)
  })
  return selectedBuiltinTools(selected)
}

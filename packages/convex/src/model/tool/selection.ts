import {
  TOOL_CAPABILITIES,
  isReservedToolName,
  selectedBuiltinTools,
} from '@cv/core/tool-capabilities'

import type { Doc, Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import { minRole } from '../../lib/roles'

/** Reads current capability choices for mode and delegation lifecycle decisions. */
export async function sessionToolNames(
  ctx: QueryCtx,
  _sessionId: Id<'sessions'>,
  agent: Doc<'agents'>,
  invokerId: Id<'users'>,
) {
  const user = await ctx.db.get(invokerId)
  const admin = minRole(user?.role, 'admin')
  const selected = agent.tools?.filter((name) => {
    const row = TOOL_CAPABILITIES.find((row) => row.name === name)
    return row && (!('requiresAdmin' in row) || admin)
  })
  const external =
    agent.tools?.filter(
      (name) => !isReservedToolName(name) && !name.startsWith('mcp_server:'),
    ) ?? []
  return [...selectedBuiltinTools(selected), ...external]
}

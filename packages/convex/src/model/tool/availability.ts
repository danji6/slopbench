'use node'

import type { ActionCtx } from '../../_generated/server'
import { minRole } from '../../lib/roles'
import type { StreamContext } from '../../types'
import type { ToolAvailability } from './manifest'

/** Reads metadata only when a fresh manifest explicitly opts into skills. */
export async function prepareToolAvailability(
  ctx: ActionCtx,
  data: StreamContext,
): Promise<ToolAvailability> {
  const availability: ToolAvailability = {
    storedMcpOutput: data.hasStoredMcpOutput,
  }
  if (data.sessionCache?.tools) return availability
  if (!data.agent.tools?.includes('skills')) return availability
  if (!minRole(data.invoker.role, 'admin')) return availability
  if (!['invoke', 'retry'].includes(data.stream.command.kind))
    return availability

  const { readSkillCatalog } = await import('../skills/runtime')
  let cursor: string | null = null
  do {
    const page = await readSkillCatalog(
      ctx,
      data.agent,
      data.session.workspace,
      cursor,
      undefined,
      data.session._id,
    )
    const readable = page.entries.filter((entry) => !entry.error)
    availability.skills ||= readable.length > 0
    availability.integrationSkills ||= readable.some((entry) =>
      entry.path.startsWith('integration://'),
    )
    cursor = page.cursor
    const foundRequiredOrigins =
      availability.skills &&
      (!data.hasIntegrationSkills || availability.integrationSkills)
    if (foundRequiredOrigins) break
    if (page.isDone) break
  } while (cursor)
  return availability
}

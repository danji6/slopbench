'use node'

import type { ActionCtx } from '../../_generated/server'
import { minRole } from '../../lib/roles'
import type { StreamContext } from '../../types'
import type { PreparedSkillCatalog } from '../skills/runtime'
import { skillCatalogSource } from './capabilitySource'
import type { ToolAvailability } from './manifest'

export type PreparedAvailability = ToolAvailability & {
  catalog?: PreparedSkillCatalog
  source: string
}

/** Scans once per invocation, repeating only when managed skill configuration changes. */
export async function prepareToolAvailability(
  ctx: ActionCtx,
  data: StreamContext,
): Promise<PreparedAvailability> {
  const source = skillCatalogSource(data)

  const availability: PreparedAvailability = {
    source,
    skills: false,
    storedMcpOutput: data.hasStoredMcpOutput,
  }

  const readsSkills =
    data.agent.tools?.includes('skills') &&
    minRole(data.invoker.role, 'admin') &&
    ['invoke', 'retry'].includes(data.stream.command.kind)
  if (!readsSkills) return availability

  if (
    data.sessionCache?.tools?.contextId &&
    data.stream.skillCatalogSource === source
  ) {
    return { ...availability, ...data.stream.skillAvailability }
  }

  const { compactSkillCatalog } = await import('../skills/runtime')

  const catalog = await compactSkillCatalog(
    ctx,
    data.agent,
    data.session.workspace,
    data.session._id,
  )

  availability.catalog = catalog

  availability.skills =
    catalog.availability?.skills ??
    catalog.entries.some((entry) => !entry.error)

  return availability
}

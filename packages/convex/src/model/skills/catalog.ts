'use node'

import { SKILL_PAGE_SIZE } from '@sb/core/skills/types'
import type {
  SkillCatalogEntry,
  SkillCatalogPage,
  SkillCatalogSlice,
} from '@sb/core/skills/types'
import type { FolderWorkspace } from '@sb/core/types/workspace'

import { internal } from '../../_generated/api'
import type { ActionCtx } from '../../_generated/server'
import type { AgentWithHome } from '../../types'
import { integrationRequest } from '../integrations/transport'
import { postSidecar } from '../sidecar'
import { CatalogWindow } from './catalogWindow'
import type { CatalogRequest } from './catalogWindow'

type AssignmentPage = {
  page: { name: string }[]
  continueCursor: string
  isDone: boolean
}

type CatalogIntegration = {
  _id: string
  root: string
  name: string
  revision: string
  skillsEnabled: boolean
  disabledSkills: string[]
}

/** Merges all skill origins before applying a bounded catalog window. */
export async function combinedSkillCatalog(
  ctx: ActionCtx,
  agent: AgentWithHome,
  workspace?: FolderWorkspace,
  input: CatalogRequest = {},
  integrations: CatalogIntegration[] = [],
): Promise<SkillCatalogPage> {
  const window = new CatalogWindow(String(agent._id), input)

  const assigned = []
  if (workspace?.agentHome) {
    for await (const entry of assignedEntries(ctx, agent, workspace)) {
      assigned.push(entry)
      if (assigned.length > 5000)
        throw new Error('Assigned skill catalog exceeds 5,000 entries')
    }
  }
  const sources = [
    ...(workspace?.agentOnly ? [] : (workspace?.sources ?? []))
      .filter((source) => source.discoverSkills !== false)
      .map((source) => ({
        root: source.path,
        origin: `Project: ${source.label}`,
      })),
    ...integrations
      .filter((row) => row.skillsEnabled)
      .map((row) => ({
        root: row.root,
        origin: `Integration: ${row.name}`,
        integrationId: row._id,
        revision: row.revision,
        disabledSkills: row.disabledSkills,
      })),
  ]
  if (!sources.length && !assigned.length) return window.finish()
  const page = await integrationRequest<SkillCatalogSlice>('catalog', {
    sources,
    assigned,
    ...window.sourceOptions(),
  })
  return window.finish(page)
}

async function* assignedEntries(
  ctx: ActionCtx,
  agent: AgentWithHome,
  workspace: FolderWorkspace,
) {
  let cursor: string | null = null
  while (true) {
    const page: AssignmentPage = await ctx.runQuery(
      internal.skills._assignments,
      {
        agentId: agent._id,
        paginationOpts: { cursor, numItems: SKILL_PAGE_SIZE },
        enabledOnly: true,
      },
    )
    const result = await assignedMetadata(
      agent,
      workspace,
      page.page.map((row) => row.name),
    )
    for (const entry of result.entries) yield { ...entry, origin: 'Agent' }
    if (page.isDone) return
    cursor = page.continueCursor
  }
}

function assignedMetadata(
  agent: AgentWithHome,
  workspace: FolderWorkspace,
  names: string[],
) {
  return postSidecar<{ entries: SkillCatalogEntry[] }>(
    '/agent-files/metadata',
    {
      ownerId: agent.ownerId,
      agentId: agent._id,
      homeId: agent.homeId,
      originAgentId: agent.home?.originAgentId,
      path: agent.home?.path,
      revision: workspace.agentHome?.revision ?? 0,
      names,
    },
  )
}

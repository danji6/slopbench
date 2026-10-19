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
import { postSidecar } from '../sidecar'
import { CatalogWindow } from './catalogWindow'
import type { CatalogRequest } from './catalogWindow'

type AssignmentPage = {
  page: { name: string }[]
  continueCursor: string
  isDone: boolean
}

/** Combines assigned and project skills without retaining an unbounded catalog in memory. */
export async function combinedSkillCatalog(
  ctx: ActionCtx,
  agent: AgentWithHome,
  workspace?: FolderWorkspace,
  input: CatalogRequest = {},
): Promise<SkillCatalogPage> {
  const window = new CatalogWindow(String(agent._id), input)

  if (workspace?.agentHome) {
    for await (const entry of assignedEntries(ctx, agent, workspace))
      await window.addAssigned(entry)
  }

  const seen = new Set<string>()
  for (const source of workspace?.agentOnly ? [] : (workspace?.sources ?? [])) {
    if (source.discoverSkills === false || seen.has(source.path)) continue
    seen.add(source.path)
    const page = await postSidecar<SkillCatalogSlice>(
      '/agent-files/project-catalog',
      {
        root: source.path,
        label: source.label,
        agentDir: workspace?.agentHome?.path,
        ...window.sourceOptions(),
      },
    )
    await window.addProject(page)
  }

  return window.finish()
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

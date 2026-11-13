'use node'

import { SKILL_PAGE_SIZE } from '@cv/core/skills/types'
import type {
  SkillCatalogEntry,
  SkillCatalogPage,
  SkillCatalogSlice,
} from '@cv/core/skills/types'
import type { FolderWorkspace } from '@cv/core/types/workspace'

import { internal } from '../../_generated/api'
import type { ActionCtx } from '../../_generated/server'
import type { AgentWithHome } from '../../types'
import { postSidecar } from '../sidecar'
import { toolkitRequest } from '../toolkits/transport'
import { CatalogWindow } from './catalogWindow'
import type { CatalogRequest } from './catalogWindow'

type AssignmentPage = {
  page: { name: string }[]
  continueCursor: string
  isDone: boolean
}

type CatalogToolkit = {
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
  toolkits: CatalogToolkit[] = [],
): Promise<SkillCatalogPage> {
  const window = new CatalogWindow(String(agent._id), input)

  const assigned = []
  if (workspace?.agentHome) {
    for await (const entry of assignedEntries(
      ctx,
      agent,
      workspace,
      input.exactName,
    )) {
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
        projectSourceId: source.id,
        agentDir: workspace?.agentHome?.path,
      })),
    ...toolkits
      .filter((row) => row.skillsEnabled)
      .map((row) => ({
        root: row.root,
        origin: `Toolkit: ${row.name}`,
        toolkitId: row._id,
        revision: row.revision,
        disabledSkills: row.disabledSkills,
      })),
  ]
  if (!sources.length && !assigned.length) return window.finish()
  const page = await toolkitRequest<SkillCatalogSlice>('catalog', {
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
  exactName?: string,
) {
  let cursor: string | null = null
  while (true) {
    const page: AssignmentPage = await ctx.runQuery(
      internal.skills._assignments,
      {
        agentId: agent._id,
        paginationOpts: { cursor, numItems: SKILL_PAGE_SIZE },
        enabledOnly: true,
        ...(exactName && { search: exactName }),
      },
    )
    const names = page.page.map((row) => row.name)
    const selected = exactName
      ? names.filter((name) => name === exactName)
      : names
    if (selected.length) {
      const result = await assignedMetadata(agent, workspace, selected)
      for (const entry of result.entries) yield { ...entry, origin: 'Agent' }
    }
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

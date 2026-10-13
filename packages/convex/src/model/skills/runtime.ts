'use node'

import {
  SKILL_CATALOG_CHARACTERS,
  catalogCursor,
  catalogEntryText,
  decodeCatalogCursor,
} from '@sb/core/skills/catalog'
import { SKILL_PAGE_SIZE } from '@sb/core/skills/types'
import type {
  AgentHome,
  SkillCatalogEntry,
  SkillCatalogPage,
} from '@sb/core/skills/types'
import type { FolderWorkspace } from '@sb/core/types/workspace'
import { withAgentHome } from '@sb/core/workspace/personal'

import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import type { Session } from '../../types'
import { postSidecar } from '../sidecar'

/** Resolves the home from the agent document. */
export async function resolvePersonalWorkspace(
  agent: Doc<'agents'>,
  project?: Session['workspace'],
): Promise<Session['workspace']> {
  if (agent.homeDetached) return project

  if (agent.homePath || agent.resolvedHomePath) {
    const status = await postSidecar<{ exists: boolean }>(
      '/agent-files/status',
      {
        ownerId: agent.ownerId,
        agentId: agent._id,
        originAgentId: agent.homeOriginAgentId,
        path: agent.homePath ?? agent.resolvedHomePath,
      },
    )
    if (!status.exists) return project
  }

  const home = await postSidecar<AgentHome>('/agent-files/home', {
    ownerId: agent.ownerId,
    agentId: agent._id,
    homeId: agent.homeId,
    originAgentId: agent.homeOriginAgentId,
    path: agent.homePath,
    revision: agent.homeRevision ?? 0,
  })

  return { ...withAgentHome(project, home), folderId: project?.folderId }
}

export async function readSkillCatalog(
  ctx: ActionCtx,
  agent: Doc<'agents'>,
  workspace: FolderWorkspace,
  cursor: string | null = null,
  search?: string,
): Promise<SkillCatalogPage> {
  const decoded = decodeCatalogCursor(cursor)

  const page = await ctx.runQuery(internal.skills._assignments, {
    agentId: agent._id,
    paginationOpts: { cursor: decoded.cursor, numItems: SKILL_PAGE_SIZE },
    search,
  })

  const result = await postSidecar<{ entries: SkillCatalogEntry[] }>(
    '/agent-files/metadata',
    {
      ownerId: agent.ownerId,
      agentId: agent._id,
      homeId: agent.homeId,
      originAgentId: agent.homeOriginAgentId,
      path: agent.homePath,
      revision: workspace.agentHome?.revision ?? 0,
      names: page.page.slice(decoded.offset).map((row) => row.name),
    },
  )

  return {
    entries: result.entries,
    cursor: page.isDone ? null : page.continueCursor,
    isDone: page.isDone,
  }
}

/** Fills a bounded prompt catalog while retaining a precise continuation position. */
export async function compactSkillCatalog(
  ctx: ActionCtx,
  agent: Doc<'agents'>,
  workspace: FolderWorkspace,
): Promise<SkillCatalogPage> {
  const entries: SkillCatalogEntry[] = []
  let cursor: string | null = null
  while (true) {
    const page = await readSkillCatalog(ctx, agent, workspace, cursor)
    for (let i = 0; i < page.entries.length; i++) {
      const entry = page.entries[i]!
      const nextCursor =
        i + 1 < page.entries.length ? catalogCursor(cursor, i + 1) : page.cursor
      const candidate = {
        entries: [...entries, entry],
        cursor: nextCursor,
        isDone: page.isDone && i + 1 === page.entries.length,
      }
      if (catalogNote(candidate).length > SKILL_CATALOG_CHARACTERS)
        return { entries, cursor: catalogCursor(cursor, i), isDone: false }
      entries.push(entry)
    }
    if (page.isDone) return { entries, cursor: null, isDone: true }
    cursor = page.cursor
  }
}

export function catalogNote(page: SkillCatalogPage) {
  if (!page.entries.length && page.isDone) return ''
  return [
    'Assigned skills: read the relevant SKILL.md with read_file and scope: "agent" before following its instructions. Paths below are relative to your personal folder.',
    ...page.entries.map(catalogEntryText),
    ...(!page.isDone
      ? [
          `More skills are available. Use list_skills to search by name or continue with cursor ${page.cursor}.`,
        ]
      : []),
  ].join('\n')
}

export async function catalogForTool(
  ctx: ActionCtx,
  agentId: Id<'agents'>,
  workspace: FolderWorkspace,
  input: { cursor?: string; search?: string },
) {
  const agent = await ctx.runQuery(internal.skills._agent, { agentId })
  if (!agent || agent.fileOperationId)
    throw new Error('Personal folder is being updated or no longer exists')
  return readSkillCatalog(
    ctx,
    agent,
    workspace,
    input.cursor ?? null,
    input.search,
  )
}

export async function desktopInfo(ctx: ActionCtx) {
  const { authorizeAdmin } = await import('../../functions')
  await authorizeAdmin(ctx)
  const { getSidecar } = await import('../sidecar')
  return getSidecar<{ supported: boolean; machine: string }>(
    '/agent-files/desktop',
  )
}

export async function openFolder(
  ctx: ActionCtx,
  agentId: Id<'agents'>,
): Promise<{ ok: boolean }> {
  const { api } = await import('../../_generated/api')

  await ctx.runQuery(api.skills.getHome, { agentId })
  const agent = await ctx.runQuery(internal.skills._agent, { agentId })
  if (!agent) throw new Error('Agent not found')

  return postSidecar<{ ok: boolean }>('/agent-files/open', {
    ownerId: agent.ownerId,
    agentId,
    originAgentId: agent.homeOriginAgentId,
    homeId: agent.homeId,
    path: agent.homePath,
  })
}

/** Checks filesystem availability using only the authenticated agent's home. */
export async function homeStatus(
  ctx: ActionCtx,
  agentId: Id<'agents'>,
): Promise<{ exists: boolean }> {
  const { api } = await import('../../_generated/api')

  const home = await ctx.runQuery(api.skills.getHome, { agentId })
  const agent = await ctx.runQuery(internal.skills._agent, { agentId })
  if (!agent || !home.path) return { exists: false }

  return postSidecar<{ exists: boolean }>('/agent-files/status', {
    ownerId: agent.ownerId,
    agentId,
    originAgentId: agent.homeOriginAgentId,
    path: home.path,
  })
}

'use node'

import { catalogEntryText } from '@sb/core/skills/catalog'
import type { AgentHome, SkillCatalogPage } from '@sb/core/skills/types'
import type { FolderWorkspace } from '@sb/core/types/workspace'
import { withAgentHome } from '@sb/core/workspace/personal'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import type { AgentWithHome, Session } from '../../types'
import { postSidecar } from '../sidecar'
import { combinedSkillCatalog } from './catalog'

/** Resolves only an explicitly assigned, available personal folder. */
export async function resolvePersonalWorkspace(
  agent: AgentWithHome,
  project?: Session['workspace'],
): Promise<Session['workspace']> {
  if (!agent.home?.path) return project
  const status = await postSidecar<{ exists: boolean }>('/agent-files/status', {
    ownerId: agent.ownerId,
    agentId: agent._id,
    originAgentId: agent.home.originAgentId,
    path: agent.home.path,
  })
  if (!status.exists) return project

  const home = await postSidecar<AgentHome>('/agent-files/home', {
    ownerId: agent.ownerId,
    agentId: agent._id,
    homeId: agent.homeId,
    originAgentId: agent.home?.originAgentId,
    path: agent.home?.path,
    revision: agent.home?.revision ?? 0,
  })

  return { ...withAgentHome(project, home), folderId: project?.folderId }
}

export async function readSkillCatalog(
  ctx: ActionCtx,
  agent: AgentWithHome,
  workspace: FolderWorkspace,
  cursor: string | null = null,
  search?: string,
): Promise<SkillCatalogPage> {
  return combinedSkillCatalog(ctx, agent, workspace, { cursor, search })
}

/** Fills a bounded catalog and fingerprints all available metadata. */
export async function compactSkillCatalog(
  ctx: ActionCtx,
  agent: AgentWithHome,
  workspace?: FolderWorkspace,
): Promise<SkillCatalogPage> {
  return combinedSkillCatalog(ctx, agent, workspace, { compact: true })
}

export function catalogNote(page: SkillCatalogPage) {
  if (!page.entries.length && page.isDone) return ''
  return [
    'Available skills: read the relevant SKILL.md with read_file at its listed path before following its instructions.',
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
  if (!agent || agent.fileOperationId || agent.home?.operationId)
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
    originAgentId: agent.home?.originAgentId,
    homeId: agent.homeId,
    path: agent.home?.path,
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
    originAgentId: agent.home?.originAgentId,
    path: home.path,
  })
}

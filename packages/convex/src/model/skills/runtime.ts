'use node'

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

/** Resolves the home only from the agent document, never model-supplied paths. */
export async function resolvePersonalWorkspace(
  agent: Doc<'agents'>,
  project?: Session['workspace'],
): Promise<NonNullable<Session['workspace']>> {
  const home = await postSidecar<AgentHome>('/agent-files/home', {
    ownerId: agent.ownerId,
    agentId: agent._id,
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
  const page = await ctx.runQuery(internal.skills._assignments, {
    agentId: agent._id,
    paginationOpts: { cursor, numItems: SKILL_PAGE_SIZE },
    search,
  })
  const result = await postSidecar<{ entries: SkillCatalogEntry[] }>(
    '/agent-files/metadata',
    {
      ownerId: agent.ownerId,
      agentId: agent._id,
      path: agent.homePath,
      revision: workspace.agentHome?.revision ?? 0,
      names: page.page.map((row) => row.name),
    },
  )
  return {
    entries: result.entries,
    cursor: page.isDone ? null : page.continueCursor,
    isDone: page.isDone,
  }
}

/** Emits stable discovery text; large libraries remain accessible through list_skills. */
export function catalogNote(page: SkillCatalogPage) {
  if (!page.entries.length && page.isDone) {
    return ''
  }
  return [
    'Assigned skills: read the relevant SKILL.md with read_file before following its instructions. Resolve supporting references relative to its skill directory. Existing tool approvals still apply.',
    ...page.entries.map((entry) =>
      entry.error
        ? `- ${entry.name}: unavailable (${entry.error}).`
        : `- ${entry.name}: ${entry.description}\n  scope: agent;\n  path: ${entry.path};\n  absolute path: ${entry.absolutePath}`,
    ),
    ...(!page.isDone
      ? [
          `This is the first page. Use list_skills to search by name or continue with cursor ${page.cursor}.`,
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
  if (!agent || agent.fileOperationId) {
    throw new Error('Personal folder is being updated or no longer exists')
  }
  return readSkillCatalog(
    ctx,
    agent,
    workspace,
    input.cursor ?? null,
    input.search,
  )
}

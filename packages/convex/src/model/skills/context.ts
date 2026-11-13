import { isSkillName } from '@cv/core/skills/names'

import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import { minRole } from '../../lib/roles'
import type {
  PrepareContextNoteArgs,
  ProjectSkillReadArgs,
  SkillReadArgs,
} from '../../types'
import { prepareContextNote } from '../stream/contextNotes'
import { ownsExecution } from '../stream/execution'
import { skillContext } from '../toolkits/skills'
import { isSkillEnabled } from './preferences'

/** Resolves a project source from the current session's discovery settings. */
export async function projectSkillAccess(
  ctx: QueryCtx,
  args: ProjectSkillReadArgs,
) {
  const { agent, workspace, sessionId } = await skillContext(ctx, args)
  if (!agent.tools?.includes('skills')) error('Skill access revoked', 403)
  const source = workspace?.sources?.find((item) => item.id === args.sourceId)
  if (
    !workspace ||
    !source ||
    workspace.agentOnly ||
    source.discoverSkills === false
  ) {
    error('Project skill unavailable', 403)
  }

  return {
    root: source.path,
    agentDir: agent.home?.path,
    sessionId,
    workspaceId: workspace.workspaceId,
    revision: workspace.revision ?? 0,
    name: args.name,
    resource: args.resource,
    offset: args.offset,
    length: args.length,
  }
}

/** Resolves an enabled assignment from the current agent's home. */
export async function assignedSkillAccess(ctx: QueryCtx, args: SkillReadArgs) {
  const { name, resource, offset, length } = args
  if (!isSkillName(name)) error('Invalid agent skill name', 400)

  const { agent } = await skillContext(ctx, args)
  if (!agent.tools?.includes('skills')) error('Skill access revoked', 403)
  const { homeId, home } = agent
  if (!homeId || !home?.path) error('Agent skill unavailable', 404)

  const assignment = await ctx.db
    .query('agentSkills')
    .withIndex('by_homeId_name', (q) => q.eq('homeId', homeId).eq('name', name))
    .unique()
  if (assignment?.ownerId !== agent.ownerId)
    error('Agent skill unavailable', 403)
  if (!isSkillEnabled(agent, assignment.skillId))
    error('Agent skill unavailable', 403)

  return {
    homeId,
    path: home.path,
    revision: home.revision,
    ownerId: agent.ownerId,
    agentId: agent._id,
    originAgentId: home.originAgentId,
    name,
    resource,
    offset,
    length,
  }
}

/** Records the catalog only for a currently authorized filesystem invocation. */
export async function prepareSkillContext(
  ctx: MutationCtx,
  args: PrepareContextNoteArgs,
) {
  const stream = await ctx.db.get(args.streamId)
  if (!ownsExecution(stream, args)) return false
  const user = await ctx.db.get(stream.invokedBy)
  if (!user || !minRole(user.role, 'admin')) return false
  return prepareContextNote(ctx, args, 'skills')
}

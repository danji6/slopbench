import { mergedStream, stream } from 'convex-helpers/server/stream'
import type { PaginationOptions } from 'convex/server'

import type { Doc, Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import schema from '../../schema'
import { isSkillEnabled } from './preferences'

export type SkillListItem = Doc<'skills'> & {
  assignmentId: Id<'agentSkills'> | null
  enabled: boolean
  libraryAvailable: boolean
}

/** Builds an agent row from its independent copy, even after library deletion. */
export async function assignedSkillItem(
  ctx: QueryCtx,
  agent: Doc<'agents'>,
  assignment: Doc<'agentSkills'>,
): Promise<SkillListItem> {
  return {
    _id: assignment.skillId,
    _creationTime: assignment._creationTime,
    ownerId: assignment.ownerId,
    name: assignment.name,
    description: assignment.description,
    status: 'ready',
    assignmentId: assignment._id,
    enabled: isSkillEnabled(agent, assignment.skillId),
    libraryAvailable: !!(await ctx.db.get(assignment.skillId)),
  }
}

/** Merges independent assignments with unassigned library entries in index order. */
export async function allAgentSkills(
  ctx: QueryCtx,
  agent: Doc<'agents'>,
  options: PaginationOptions,
  prefix: string,
  notAdded: boolean,
) {
  const library = unassignedLibraryStream(ctx, agent, prefix)
  if (notAdded || !agent.homeId) return library.paginate(options)

  const assigned = stream(ctx.db, schema)
    .query('agentSkills')
    .withIndex('by_homeId_name', (q) => {
      const home = q.eq('homeId', agent.homeId!)
      return prefix
        ? home.gte('name', prefix).lt('name', `${prefix}\uffff`)
        : home
    })
    .map((assignment) => assignedSkillItem(ctx, agent, assignment))

  return mergedStream(
    [library, assigned],
    ['name', '_creationTime', '_id'],
  ).paginate(options)
}

/** Omits library names already provided by the agent's own copies. */
function unassignedLibraryStream(
  ctx: QueryCtx,
  agent: Doc<'agents'>,
  prefix: string,
) {
  return stream(ctx.db, schema)
    .query('skills')
    .withIndex('by_ownerId_name', (q) => {
      const owned = q.eq('ownerId', agent.ownerId)
      return prefix
        ? owned.gte('name', prefix).lt('name', `${prefix}\uffff`)
        : owned
    })
    .map(async (skill): Promise<SkillListItem | null> => {
      const assignment = agent.homeId
        ? await ctx.db
            .query('agentSkills')
            .withIndex('by_homeId_name', (q) =>
              q.eq('homeId', agent.homeId!).eq('name', skill.name),
            )
            .first()
        : null
      if (assignment) return null
      return {
        ...skill,
        assignmentId: null,
        enabled: isSkillEnabled(agent, skill._id),
        libraryAvailable: true,
      }
    })
}

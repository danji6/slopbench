'use node'

import { isSkillName } from '@cv/core/skills/names'
import { stableStringify } from '@cv/core/stable-json'

import { internal } from '../../_generated/api'
import type { ActionCtx } from '../../_generated/server'
import { ToolError, error } from '../../errors'
import type { ProjectSkillReadArgs, StreamExecutionArgs } from '../../types'
import { postSidecar } from '../sidecar'
import { readSkill as readToolkitSkill } from '../toolkits/skillActions'
import {
  catalogForTool,
  readAssignedSkill,
  resolvePersonalWorkspace,
} from './runtime'

type SkillRead = {
  skill_id: string
  resource?: string
  offset: number
  length: number
}

export async function readSkill(
  ctx: ActionCtx,
  execution: StreamExecutionArgs,
  input: SkillRead,
) {
  const { skill_id, resource = 'SKILL.md', offset, length } = input
  const id = isSkillName(skill_id)
    ? await findNamedSkill(ctx, execution, skill_id)
    : skill_id
  return readQualifiedSkill(ctx, { ...execution, offset, length }, id, resource)
}

type SkillReadRange = StreamExecutionArgs & Pick<SkillRead, 'offset' | 'length'>

function readQualifiedSkill(
  ctx: ActionCtx,
  args: SkillReadRange,
  id: string,
  resource: string,
) {
  const separator = id.indexOf('@')
  const name = id.slice(0, separator)
  const source = id.slice(separator + 1)
  if (separator < 0 || !isSkillName(name))
    throw new ToolError('Invalid skill_id')

  const target = { ...args, name, resource }
  if (source === 'agent') return readAssignedSkill(ctx, target)
  if (source.startsWith('toolkit:')) {
    const toolkitId = source.slice('toolkit:'.length)
    if (!toolkitId) throw new ToolError('Invalid toolkit skill ID')
    return readToolkitSkill(ctx, { ...target, toolkitId })
  }
  if (source.startsWith('project:')) {
    const sourceId = source.slice('project:'.length)
    return readProjectSkill(ctx, { ...target, sourceId })
  }
  throw new ToolError('Invalid skill_id. Use an ID from list_skills')
}

async function findNamedSkill(
  ctx: ActionCtx,
  execution: StreamExecutionArgs,
  name: string,
) {
  const live = await ctx.runQuery(internal.toolkits._skillContext, execution)
  if (!live.agent.tools?.includes('skills')) error('Skill access revoked', 403)

  const workspace = await resolvePersonalWorkspace(live.agent, live.workspace)
  const catalog = await catalogForTool(
    ctx,
    live.agent._id,
    workspace,
    { exactName: name },
    live.sessionId,
  )

  const ids = catalog.entries.flatMap((entry) =>
    entry.skill_id ? [entry.skill_id] : [],
  )
  if (!ids.length) {
    throw new ToolError(`Skill "${name}" is unavailable`)
  }
  if (ids.length > 1) {
    throw new ToolError(
      `More than one skill is named "${name}". Choose a skill_id from list_skills`,
    )
  }

  return ids[0]!
}

async function readProjectSkill(ctx: ActionCtx, args: ProjectSkillReadArgs) {
  const access = await ctx.runQuery(internal.skills._projectSkillAccess, args)
  const result = await postSidecar('/agent-files/read-project-skill', access)
  const current = await ctx.runQuery(internal.skills._projectSkillAccess, args)
  if (stableStringify(access) !== stableStringify(current))
    error('Project skill access changed while reading', 409)
  return result
}

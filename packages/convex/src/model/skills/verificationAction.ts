'use node'

import type { PaginationOptions } from 'convex/server'

import { api, internal } from '../../_generated/api'
import type { Doc } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { authorizeAdmin } from '../../functions'
import type { SkillVerificationPage, VerifySkillIdsArgs } from '../../types'
import { postSidecar } from '../sidecar'

/** Checks one complete-library page, independent of the UI's search and loaded rows. */
export async function checkLibraryPage(
  ctx: ActionCtx,
  { paginationOpts }: { paginationOpts: PaginationOptions },
): Promise<SkillVerificationPage> {
  await authorizeAdmin(ctx)
  const page = await ctx.runQuery(api.skills.list, {
    paginationOpts: { ...paginationOpts, numItems: 20 },
  })
  const candidates = page.page.filter(canCheckSkill)
  const missing = await findMissing(candidates)
  return {
    missing: candidates
      .filter((skill) => missing.has(skill._id))
      .map((skill) => ({ skillId: skill._id, name: skill.name })),
    checked: candidates.length,
    skipped: page.page.length - candidates.length,
    isDone: page.isDone,
    continueCursor: page.continueCursor,
  }
}

/** Rechecks confirmed candidates before removing only their missing library records. */
export async function removeMissingSkills(
  ctx: ActionCtx,
  args: VerifySkillIdsArgs,
): Promise<{ removed: number }> {
  await authorizeAdmin(ctx)
  const skills = await ctx.runQuery(api.skills.verificationTargets, args)
  const candidates = skills.filter(canCheckSkill)
  const missing = await findMissing(candidates)
  let removed = 0
  for (const skill of candidates) {
    if (!missing.has(skill._id)) continue
    const deleted = await ctx.runMutation(internal.skills._removeMissingSkill, {
      skillId: skill._id,
      ownerId: skill.ownerId,
      importOperationId: skill.importOperationId,
    })
    if (deleted) removed++
  }
  return { removed }
}

function canCheckSkill(skill: Doc<'skills'>) {
  return !skill.operationId && skill.status !== 'installing'
}

async function findMissing(skills: Doc<'skills'>[]) {
  if (!skills.length) return new Set<string>()
  const { missing } = await postSidecar<{ missing: string[] }>(
    '/agent-files/verify-library',
    {
      ownerId: skills[0]!.ownerId,
      skills: skills.map((skill) => ({ skillId: skill._id, name: skill.name })),
    },
  )
  return new Set(missing)
}

'use node'

import type {
  SkillImportCandidate,
  SkillImportPage,
  SkillMetadata,
} from '@sb/core/skills/types'
import { errorMessage } from '@sb/core/utils/errors'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { postSidecar } from '../sidecar'
import type { ExecutionContext } from './execution'
import { importSource } from './uploadAction'

type ImportContext = Extract<ExecutionContext, { kind: 'install' }>

/** Discovers once, then copies and commits a bounded page of independent skills. */
export async function importSkills(
  ctx: ActionCtx,
  data: ImportContext,
): Promise<boolean> {
  const op = data.operation
  await discover(ctx, data)

  const page = await postSidecar<SkillImportPage>('/agent-files/import-page', {
    id: `${op._id}-discover`,
    cursor: op.progress.cursor,
  })
  if (!page.entries.length && !op.progress.cursor)
    throw new Error('No SKILL.md files found in this directory or ZIP')

  let cursor = op.progress.cursor
  const started = Date.now()
  for (const candidate of page.entries) {
    await installCandidate(ctx, data, candidate, cursor)
    cursor = candidate.nextCursor
    const shouldYield =
      Date.now() - started >= 4 * 60_000 && cursor !== page.nextCursor
    if (shouldYield) {
      await scheduleContinuation(ctx, data, cursor)
      return false
    }
  }
  if (!page.isDone) {
    await scheduleContinuation(ctx, data, cursor)
    return false
  }
  return true
}

async function scheduleContinuation(
  ctx: ActionCtx,
  data: ImportContext,
  cursor: number,
) {
  await ctx.runMutation(internal.skills._continueImport, {
    operationId: data.operation._id,
    attempt: data.operation.attempt,
    cursor,
  })
}

async function discover(ctx: ActionCtx, data: ImportContext) {
  const op = data.operation
  await postSidecar('/agent-files/operation', {
    id: `${op._id}-discover`,
    ownerId: op.ownerId,
    kind: 'discover-import',
    ...(await importSource(ctx, op)),
  })
}

async function installCandidate(
  ctx: ActionCtx,
  data: ImportContext,
  candidate: SkillImportCandidate & { nextCursor: number },
  cursor: number,
) {
  const op = data.operation
  let skillId: Id<'skills'> | undefined
  let outcome: 'installed' | 'skipped' | 'failed'
  let message = candidate.error
  try {
    if (!candidate.metadata)
      throw new Error(message ?? 'Invalid skill manifest')

    skillId =
      (await ctx.runMutation(internal.skills._prepareImportSkill, {
        operationId: op._id,
        attempt: op.attempt,
        cursor,
        metadata: candidate.metadata,
      })) ?? undefined
    outcome = skillId ? 'installed' : 'skipped'

    if (skillId) {
      const metadata = await postSidecar<SkillMetadata>(
        '/agent-files/operation',
        {
          id: `${op._id}-${skillId}`,
          ownerId: op.ownerId,
          kind: 'install',
          skillId,
          source: candidate.path,
        },
      )
      if (metadata.name !== candidate.metadata.name)
        throw new Error('Skill name changed during import, try again')
    }
  } catch (error) {
    outcome = 'failed'
    message = errorMessage(error) ?? 'Skill import failed'
  }

  await ctx.runMutation(internal.skills._finishImportSkill, {
    operationId: op._id,
    attempt: op.attempt,
    cursor,
    nextCursor: candidate.nextCursor,
    skillId,
    outcome,
    message,
  })
}

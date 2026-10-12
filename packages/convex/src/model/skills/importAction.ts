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
import type { OperationContext } from './operations'

/** Discovers once, then copies and commits a bounded page of independent skills. */
export async function importSkills(
  ctx: ActionCtx,
  data: OperationContext,
): Promise<Record<string, never> | undefined> {
  const op = data.operation
  await discover(ctx, data)

  const page = await postSidecar<SkillImportPage>('/agent-files/import-page', {
    id: `${op._id}-discover`,
    cursor: op.importCursor ?? 0,
  })
  if (!page.entries.length && !op.importCursor)
    throw new Error('No SKILL.md files found in this directory or ZIP')

  let cursor = op.importCursor ?? 0
  const started = Date.now()
  for (const candidate of page.entries) {
    await installCandidate(ctx, data, candidate, cursor)
    cursor = candidate.nextCursor
    if (Date.now() - started >= 4 * 60_000 && cursor !== page.nextCursor) {
      await ctx.runMutation(internal.skills._continueImport, {
        operationId: op._id,
        cursor,
      })
      return
    }
  }
  if (!page.isDone) {
    await ctx.runMutation(internal.skills._continueImport, {
      operationId: op._id,
      cursor,
    })
    return
  }
  return {}
}

async function discover(ctx: ActionCtx, data: OperationContext) {
  const op = data.operation
  const fileUrl = op.storageId
    ? await ctx.storage.getUrl(op.storageId)
    : undefined

  const upload = op.storageId
    ? await ctx.runQuery(internal.skills._getUpload, {
        storageId: op.storageId,
      })
    : null
  if (upload && upload.ownerId !== op.ownerId)
    throw new Error('Skill upload not found')

  if (fileUrl && op.uploadTicket && !upload?.verified) {
    const proof = await postSidecar<{ verified: boolean }>(
      '/agent-files/verify-upload',
      { fileUrl, ticket: op.uploadTicket },
    )
    if (!proof.verified)
      throw new Error('Skill upload does not belong to this import')
    if (upload)
      await ctx.runMutation(internal.skills._verifyUpload, {
        uploadId: upload._id,
      })
  }

  await postSidecar('/agent-files/operation', {
    id: `${op._id}-discover`,
    ownerId: op.ownerId,
    kind: 'discover-import',
    source: op.source,
    fileUrl,
    ticket: op.uploadTicket,
  })
}

async function installCandidate(
  ctx: ActionCtx,
  data: OperationContext,
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
    cursor,
    nextCursor: candidate.nextCursor,
    skillId,
    outcome,
    message,
  })
}

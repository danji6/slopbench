'use node'

import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { postSidecar } from '../sidecar'

/** Cleans abandoned uploads after verifying they belong to the owner. */
export async function expireUpload(
  ctx: ActionCtx,
  uploadId: Id<'skillUploads'>,
) {
  const upload = await ctx.runQuery(internal.skills._getUpload, { uploadId })
  if (!upload) return

  if (upload.storageId && !upload.verified) {
    const fileUrl = await ctx.storage.getUrl(upload.storageId)
    if (fileUrl) {
      try {
        const proof = await postSidecar<{ verified: boolean }>(
          '/agent-files/verify-upload',
          { fileUrl, ticket: upload.ticket },
        )
        if (proof.verified) {
          await ctx.runMutation(internal.skills._verifyUpload, { uploadId })
        }
      } catch {
        await ctx.scheduler.runAfter(
          60 * 60_000,
          internal.actions.skills._expireUpload,
          { uploadId },
        )
        return
      }
    }
  }
  await ctx.runMutation(internal.skills._deleteUpload, { uploadId })
}

/** Verifies ownership once and resolves the immutable upload used by an import. */
export async function importSource(
  ctx: ActionCtx,
  op: Extract<Doc<'agentFileOperations'>, { kind: 'install' }>,
) {
  if (op.source.kind === 'directory') return { source: op.source.path }
  const upload = await ctx.runQuery(internal.skills._getUpload, {
    storageId: op.source.storageId,
  })
  const fileUrl = await ctx.storage.getUrl(op.source.storageId)

  const unavailable =
    !upload ||
    upload.ownerId !== op.ownerId ||
    upload.ticket !== op.source.ticket ||
    !fileUrl
  if (unavailable)
    throw new Error('Skill upload is unavailable; upload the ZIP again')

  if (!upload.verified) {
    const proof = await postSidecar<{ verified: boolean }>(
      '/agent-files/verify-upload',
      { fileUrl, ticket: upload.ticket },
    )
    if (!proof.verified)
      throw new Error('Skill upload does not belong to this import')

    await ctx.runMutation(internal.skills._verifyUpload, {
      uploadId: upload._id,
    })
  }

  return { fileUrl, ticket: upload.ticket }
}

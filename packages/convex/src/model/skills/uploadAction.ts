'use node'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
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

'use node'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { transferTarget } from '../../model/attachmentTransfers'

export async function cleanAttachmentTransfer(
  ctx: ActionCtx,
  { id }: { id: Id<'attachmentTransfers'> },
) {
  const row = await ctx.runQuery(internal.attachments._getTransfer, { id })
  if (!row || row.cleaned || row.expiresAt > Date.now()) return

  const { postSidecar } = await import('../../model/sidecar')

  const request = {
    operationId: row._id,
    rollback:
      !row.result && row.kind === 'copy_attachment'
        ? transferTarget(row)
        : undefined,
    discardUpload: !row.result && row.kind === 'attach_file',
  }
  const { storageId } = await postSidecar<{ storageId?: Id<'_storage'> }>(
    '/session-files/cleanup-transfer',
    request,
  )

  if (storageId) {
    await ctx.runMutation(internal.attachments._discardTransferUpload, {
      id,
      storageId,
    })
    await postSidecar('/session-files/cleanup-transfer', {
      operationId: row._id,
      discardUpload: false,
    })
  }
  await ctx.runMutation(internal.attachments._cleanTransfer, { id })
}

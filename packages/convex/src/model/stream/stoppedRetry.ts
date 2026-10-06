import type { Doc } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { setSelectedVersion } from '../messageContents'

/** Restores the prior version when a retry is cancelled before producing output. */
export async function restoreEmptyRetry(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
  message: Doc<'messages'>,
  row: Doc<'messageContents'>,
) {
  if (
    stream.operation !== 'retry' ||
    stream.retryPreviousVersion === undefined ||
    row.segmentIndex !== 0 ||
    row.parts.some(hasOutput)
  ) {
    return false
  }

  await setSelectedVersion(ctx, message, stream.retryPreviousVersion)
  await ctx.db.delete(row._id)
  await ctx.db.patch(message._id, {
    status: 'done',
    activeSegmentIndex: undefined,
    versionCount: message.versionCount - 1,
  })
  return true
}

function hasOutput(part: unknown) {
  const value = part as { type?: string; text?: string }
  if (value.type === 'step-start') return false
  if (value.type === 'text' || value.type === 'reasoning') {
    return Boolean(value.text?.trim())
  }
  return true
}

'use node'

import { attachmentRef } from '@sb/core/attachments'
import { block } from '@sb/core/utils/blocks'
import { isKnownTextFile } from '@sb/core/workspace/files'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { encodeBase64 } from '../../model/io/base64'

export { activeAttachmentMessages } from '../../model/attachmentMedia'

export type AttachmentResolveOptions = {
  mediaActive: boolean
  readerEnabled: boolean
  toolMediaActive: boolean
}

/** Resolves one stored attachment into bounded metadata or active media. */
export async function resolveAttachmentPart(
  ctx: ActionCtx,
  part: unknown,
  options: AttachmentResolveOptions,
) {
  if (!isAttachmentPart(part) || part.url.startsWith('data:')) return part

  const attachment = await ctx.runQuery(internal.attachments._get, {
    attachmentId: part.attachmentId,
  })
  if (!attachment) return part

  if (isKnownTextFile(attachment.mediaType, attachment.filename)) {
    return {
      type: 'text' as const,
      text: attachmentDescriptor(attachment, options.readerEnabled),
    }
  }
  if (!options.mediaActive) {
    return {
      type: 'text' as const,
      text: attachmentDescriptor(attachment, false),
    }
  }

  const blob = await ctx.storage.get(
    attachment.previewStorageId ?? attachment.storageId,
  )
  if (!blob) return part

  const mediaType =
    (attachment.previewStorageId && attachment.previewMediaType) ||
    attachment.mediaType ||
    'application/octet-stream'
  const base64 = encodeBase64(new Uint8Array(await blob.arrayBuffer()))

  return {
    type: 'file' as const,
    url: `data:${mediaType};base64,${base64}`,
    mediaType,
    filename: attachment.filename,
  }
}

function attachmentDescriptor(
  attachment: {
    filename: string
    mediaType: string
    byteLength?: number
    shareToken?: string
  },
  readerEnabled: boolean,
) {
  const reference = attachment.shareToken
    ? attachmentRef(attachment.shareToken, attachment.filename)
    : null
  return block(
    'attachment',
    readerEnabled
      ? 'Use read_attachment with this reference to read the file in bounded ranges.'
      : 'Attachment contents were not loaded.',
    {
      reference: reference ?? 'unavailable',
      filename: attachment.filename,
      mediaType: attachment.mediaType,
      bytes: String(attachment.byteLength ?? 'unknown'),
    },
  )
}

function isAttachmentPart(
  part: unknown,
): part is { type: 'file'; url: string; attachmentId: Id<'attachments'> } {
  return (
    typeof part === 'object' &&
    part !== null &&
    (part as { type?: unknown }).type === 'file' &&
    typeof (part as { attachmentId?: unknown }).attachmentId === 'string' &&
    typeof (part as { url?: unknown }).url === 'string'
  )
}

'use node'

import { attachmentRef } from '@cv/core/attachments'
import { block } from '@cv/core/utils/blocks'
import { isKnownTextFile } from '@cv/core/workspace/files'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { encodeBase64 } from '../../model/io/base64'

export { activeAttachmentMessages } from '../../model/attachmentMedia'

export type AttachmentResolveOptions = {
  mediaActive: boolean
  copyEnabled?: boolean
  readerEnabled: boolean
  toolMediaActive: boolean
}

/** Adds the original reference even when the provider receives inline preview bytes. */
export async function resolveAttachmentHistoryParts(
  ctx: ActionCtx,
  part: unknown,
  options: AttachmentResolveOptions,
) {
  if (!options.copyEnabled || !isAttachmentPart(part) || part.publishedByTool)
    return [await resolveAttachmentPart(ctx, part, options)]

  const attachment = await getAttachment(ctx, part.attachmentId)
  if (!attachment) return [part]

  const resolved = await resolveStoredAttachment(ctx, part, options, attachment)
  if (!isFilePart(resolved)) return [resolved]

  return [
    { type: 'text' as const, text: attachmentDescriptor(attachment, options) },
    resolved,
  ]
}

function isFilePart(part: unknown) {
  return (part as { type?: string } | null)?.type === 'file'
}

/** Resolves one stored attachment into bounded metadata or active media. */
export async function resolveAttachmentPart(
  ctx: ActionCtx,
  part: unknown,
  options: AttachmentResolveOptions,
) {
  if (!isAttachmentPart(part) || part.url.startsWith('data:')) return part

  const attachment = await getAttachment(ctx, part.attachmentId)
  if (!attachment) return part
  return resolveStoredAttachment(ctx, part, options, attachment)
}

type StoredAttachment = NonNullable<Awaited<ReturnType<typeof getAttachment>>>

function getAttachment(ctx: ActionCtx, attachmentId: Id<'attachments'>) {
  return ctx.runQuery(internal.attachments._get, { attachmentId })
}

async function resolveStoredAttachment(
  ctx: ActionCtx,
  part: { publishedByTool?: boolean },
  options: AttachmentResolveOptions,
  attachment: StoredAttachment,
) {
  if (isKnownTextFile(attachment.mediaType, attachment.filename)) {
    return {
      type: 'text' as const,
      text: attachmentDescriptor(attachment, options),
    }
  }
  if (!options.mediaActive || part.publishedByTool) {
    return {
      type: 'text' as const,
      text: attachmentDescriptor(attachment, {
        ...options,
        readerEnabled: false,
      }),
    }
  }

  const blob = await ctx.storage.get(
    attachment.previewStorageId ?? attachment.storageId,
  )
  if (!blob)
    return {
      type: 'text' as const,
      text: attachmentDescriptor(attachment, options),
    }

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
  { readerEnabled, copyEnabled }: AttachmentResolveOptions,
) {
  const reference = attachment.shareToken
    ? attachmentRef(attachment.shareToken, attachment.filename)
    : null
  return block(
    'attachment',
    [
      ...(readerEnabled
        ? ['Use read_attachment with this reference to read its contents.']
        : []),
      ...(copyEnabled
        ? [
            'Use copy_attachment with this reference to work with the original file.',
          ]
        : []),
    ].join(' ') || 'Reader unavailable; attachment contents were not loaded.',
    {
      reference: reference ?? 'unavailable',
      filename: attachment.filename,
      mediaType: attachment.mediaType,
      bytes: String(attachment.byteLength ?? 'unknown'),
    },
  )
}

function isAttachmentPart(part: unknown): part is {
  type: 'file'
  url: string
  attachmentId: Id<'attachments'>
  publishedByTool?: boolean
} {
  return (
    typeof part === 'object' &&
    part !== null &&
    (part as { type?: unknown }).type === 'file' &&
    typeof (part as { attachmentId?: unknown }).attachmentId === 'string' &&
    typeof (part as { url?: unknown }).url === 'string'
  )
}

import type { Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { error } from '../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../functions'
import { allVersionParts } from './messageContents'
import { getMember, requireEnabled, requireMember } from './session/memberships'

const STAGED_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000

export async function generateUploadUrl(ctx: AuthMutationCtx) {
  return ctx.storage.generateUploadUrl()
}

export async function confirm(
  ctx: AuthMutationCtx,
  args: {
    storageId: Id<'_storage'>
    previewStorageId?: Id<'_storage'>
    sessionId: Id<'sessions'>
    filename: string
    mediaType: string
  },
) {
  const { session } = await requireMember(ctx, args.sessionId, ctx.userId)
  requireEnabled(session)
  return ctx.db.insert('attachments', { ...args, uploaderId: ctx.userId })
}

export async function getUrl(
  ctx: AuthQueryCtx,
  args: { attachmentId: Id<'attachments'> },
) {
  const attachment = await requireReadable(ctx, args.attachmentId)
  return ctx.storage.getUrl(attachment.storageId)
}

export async function get(
  ctx: AuthQueryCtx,
  args: { attachmentId: Id<'attachments'> },
) {
  return requireReadable(ctx, args.attachmentId)
}

export async function _get(
  ctx: QueryCtx,
  { attachmentId }: { attachmentId: Id<'attachments'> },
) {
  const attachment = await ctx.db.get(attachmentId)
  if (!attachment) return null

  return {
    storageId: attachment.storageId,
    previewStorageId: attachment.previewStorageId,
    mediaType: attachment.mediaType,
    filename: attachment.filename,
  }
}

export async function listBySession(
  ctx: AuthQueryCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  await requireMember(ctx, sessionId, ctx.userId)
  return ctx.db
    .query('attachments')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()
}

export async function remove(
  ctx: AuthMutationCtx,
  { attachmentId }: { attachmentId: Id<'attachments'> },
) {
  const attachment = await ctx.db.get(attachmentId)
  if (!attachment) return
  const { session } = await requireMember(ctx, attachment.sessionId, ctx.userId)
  if (attachment.messageId) error('Delete the owning message instead', 409)
  if (attachment.uploaderId !== ctx.userId && session.ownerId !== ctx.userId) {
    error('Forbidden', 403)
  }
  await removeAttachment(ctx, attachment)
}

export async function getUrlPair(
  ctx: AuthQueryCtx,
  args: { attachmentId: Id<'attachments'> },
) {
  const attachment = await requireReadable(ctx, args.attachmentId)
  const url = await ctx.storage.getUrl(attachment.storageId)
  return (
    url && {
      url,
      mediaType: attachment.mediaType,
      filename: attachment.filename,
      createdAt: attachment._creationTime,
    }
  )
}

export async function getUrlMap(
  ctx: AuthQueryCtx,
  { ids }: { ids: Id<'attachments'>[] },
) {
  const result: Record<
    string,
    {
      url: string
      previewUrl: string | null
      mediaType: string
      filename: string
      createdAt: number
    }
  > = {}
  for (const id of ids) {
    const attachment = await readableOrNull(ctx, id)
    if (!attachment) continue

    const url = await ctx.storage.getUrl(attachment.storageId)
    const previewUrl = attachment.previewStorageId
      ? await ctx.storage.getUrl(attachment.previewStorageId)
      : url

    if (url)
      result[id] = {
        url,
        previewUrl,
        mediaType: attachment.mediaType,
        filename: attachment.filename,
        createdAt: attachment._creationTime,
      }
  }
  return result
}

export async function _createGenerated(
  ctx: MutationCtx,
  args: {
    streamId: Id<'streams'>
    messageId: Id<'messages'>
    sessionId: Id<'sessions'>
    uploaderId: Id<'users'>
    storageId: Id<'_storage'>
    filename: string
    mediaType: string
  },
) {
  return ctx.db.insert('attachments', args)
}

/** Deletes generated files that didn't make it into the final message. */
export async function cleanUpGeneratedAttachments(
  ctx: MutationCtx,
  streamId: Id<'streams'>,
) {
  const rows = await ctx.db
    .query('attachments')
    .withIndex('by_streamId', (q) => q.eq('streamId', streamId))
    .collect()
  if (rows.length === 0) return

  const referencedByMessage = new Map<Id<'messages'>, Set<string>>()
  for (const row of rows) {
    if (!row.messageId || referencedByMessage.has(row.messageId)) continue
    referencedByMessage.set(
      row.messageId,
      collectReferencedAttachmentIds(await allVersionParts(ctx, row.messageId)),
    )
  }

  for (const row of rows) {
    const referenced = row.messageId
      ? referencedByMessage.get(row.messageId)?.has(row._id)
      : false
    if (referenced) {
      await ctx.db.patch(row._id, { streamId: undefined })
    } else {
      await removeAttachment(ctx, row)
    }
  }
}

export async function pruneOrphans(ctx: MutationCtx) {
  const cutoff = Date.now() - STAGED_ATTACHMENT_TTL_MS
  const attachments = await ctx.db.query('attachments').collect()
  for (const attachment of attachments) {
    if (attachment._creationTime >= cutoff) continue

    // Staged uploads that were never linked to a message.
    if (!attachment.messageId) {
      await removeAttachment(ctx, attachment)
      continue
    }

    // Orphaned AI-generated files
    if (attachment.streamId) {
      if (await ctx.db.get(attachment.streamId)) continue
      const referenced = collectReferencedAttachmentIds(
        await allVersionParts(ctx, attachment.messageId),
      ).has(attachment._id)
      if (!referenced) await removeAttachment(ctx, attachment)
    }
  }
}

function collectReferencedAttachmentIds(parts: unknown[]): Set<string> {
  const ids = new Set<string>()
  for (const part of parts) {
    if (
      typeof part === 'object' &&
      part !== null &&
      (part as { type?: unknown }).type === 'file' &&
      typeof (part as { attachmentId?: unknown }).attachmentId === 'string'
    ) {
      ids.add((part as { attachmentId: string }).attachmentId)
    }
  }
  return ids
}

export async function removeAttachment(
  ctx: MutationCtx,
  attachment: {
    _id: Id<'attachments'>
    storageId: Id<'_storage'>
    previewStorageId?: Id<'_storage'>
  },
) {
  await ctx.storage.delete(attachment.storageId).catch(() => {})
  if (attachment.previewStorageId)
    await ctx.storage.delete(attachment.previewStorageId).catch(() => {})
  await ctx.db.delete(attachment._id)
}

async function requireReadable(
  ctx: AuthQueryCtx,
  attachmentId: Id<'attachments'>,
) {
  const attachment = await ctx.db.get(attachmentId)
  if (!attachment) error('Not found', 404)
  await requireMember(ctx, attachment.sessionId, ctx.userId)
  return attachment
}

async function readableOrNull(
  ctx: AuthQueryCtx,
  attachmentId: Id<'attachments'>,
) {
  const attachment = await ctx.db.get(attachmentId)
  if (!attachment) return null
  const member = await getMember(ctx, attachment.sessionId, ctx.userId)
  return member ? attachment : null
}

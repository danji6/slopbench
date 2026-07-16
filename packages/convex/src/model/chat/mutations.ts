import type { Doc, Id } from '../../_generated/dataModel'
import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import { minRole } from '../../lib/roles'
import type { DeleteMessagePartsArgs, EditMessagePartArgs } from '../../types'
import * as Attachments from '../attachments'
import * as Avatars from '../avatars'
import {
  deleteVersions,
  getSegmentRow,
  listSelectedSegments,
  replaceSelectedContent,
  setSegmentParts,
} from '../messageContents'
import { scheduleMessageEval } from '../messages'
import * as Memberships from '../session/memberships'
import { collectToolOutputStorageIds } from '../stream/toolOutput'
import { rewindTurnCount } from './reminders'

export async function editMessage(
  ctx: AuthMutationCtx,
  args: { messageId: Id<'messages'>; content: string },
) {
  const { message } = await requireMessageMutation(ctx, args.messageId)
  const parts = [{ type: 'text', text: args.content }]

  const segments = await listSelectedSegments(ctx, message)
  await deleteToolOutput(
    ctx,
    segments.flatMap((segment) => segment.parts),
  )
  await replaceSelectedContent(ctx, message, parts)

  await scheduleMessageEval(ctx, {
    messageId: message._id,
    invokerId: ctx.userId,
    parts,
    version: message.selectedVersion,
    segmentIndex: 0,
  })
}

export async function editMessagePart(
  ctx: AuthMutationCtx,
  args: EditMessagePartArgs,
) {
  const { message } = await requireMessageMutation(ctx, args.messageId)
  const row = await getSegmentRow(
    ctx,
    message._id,
    message.selectedVersion,
    args.segmentIndex,
  )
  if (!row) error('Not found', 404)

  const part = row.parts[args.partIndex]
  if (!isEditablePart(part)) error('Part is not editable', 400)

  const parts = [...row.parts]
  parts[args.partIndex] = { ...part, text: args.text }

  await setSegmentParts(ctx, message, row, parts)

  await scheduleMessageEval(ctx, {
    messageId: message._id,
    invokerId: ctx.userId,
    parts,
    version: message.selectedVersion,
    segmentIndex: args.segmentIndex,
  })
}

/** @returns true when removing the parts deleted the whole message. */
export async function deleteMessageParts(
  ctx: AuthMutationCtx,
  args: DeleteMessagePartsArgs,
): Promise<boolean> {
  const { message } = await requireMessageMutation(ctx, args.messageId)
  const segments = await listSelectedSegments(ctx, message)

  const explicit = new Map<number, Set<number>>()
  for (const address of args.addresses) {
    const indices = explicit.get(address.segmentIndex) ?? new Set<number>()
    indices.add(address.partIndex)
    explicit.set(address.segmentIndex, indices)
  }

  const from = args.from
  const shouldRemove = (segmentIndex: number, partIndex: number) => {
    if (explicit.get(segmentIndex)?.has(partIndex)) return true
    if (!from) return false
    return (
      segmentIndex > from.segmentIndex ||
      (segmentIndex === from.segmentIndex && partIndex >= from.partIndex)
    )
  }

  const removed: unknown[] = []
  const plans = segments.map((row) => {
    const kept = row.parts.filter(
      (_, index) => !shouldRemove(row.segmentIndex, index),
    )
    removed.push(
      ...row.parts.filter((_, index) => shouldRemove(row.segmentIndex, index)),
    )
    return { row, kept }
  })

  if (plans.every(({ kept }) => kept.length === 0)) {
    await deleteMessageDoc(ctx, message)
    await rewindTurnCount(ctx, message.sessionId, countTurnDocs([message]))
    return true
  }

  await removeAttachmentsForParts(ctx, message._id, removed)
  await deleteToolOutput(ctx, removed)

  for (const { row, kept } of plans) {
    if (kept.length === row.parts.length) continue
    if (kept.length === 0) {
      // Emptied segments are dropped without renumbering the remaining
      // ones (gaps keep later part addresses stable)
      await ctx.db.delete(row._id)
    } else {
      await setSegmentParts(ctx, message, row, kept)
    }
  }

  return false
}

export async function deleteMessage(
  ctx: AuthMutationCtx,
  args: { messageId: Id<'messages'> },
) {
  const { message } = await requireMessageMutation(ctx, args.messageId)
  await deleteMessageDoc(ctx, message)
  await rewindTurnCount(ctx, message.sessionId, countTurnDocs([message]))
}

export async function deleteMessagesFrom(
  ctx: AuthMutationCtx,
  args: { messageId: Id<'messages'> },
) {
  const { message, session } = await requireMessageMutation(ctx, args.messageId)

  if (await Memberships.getActiveStream(ctx, message.sessionId)) {
    error('Session is busy', 409)
  }

  const range = await ctx.db
    .query('messages')
    .withIndex('by_sessionId', (q) =>
      q
        .eq('sessionId', message.sessionId)
        .gte('_creationTime', message._creationTime),
    )
    .collect()

  assertRangeDeletable(ctx, range, session)

  const avatarIds = new Set<Id<'avatars'>>()
  for (const doc of range) {
    await deleteMessageDoc(ctx, doc, avatarIds)
  }
  for (const avatarId of avatarIds) {
    await Avatars.removeIfUnreferenced(ctx, avatarId)
  }
  await rewindTurnCount(ctx, message.sessionId, countTurnDocs(range))
}

/** Count turns while excluding hidden messages. */
function countTurnDocs(docs: Doc<'messages'>[]) {
  return docs.filter((doc) => !doc.hidden).length
}

export function assertRangeDeletable(
  ctx: Pick<AuthMutationCtx, 'userId' | 'role'>,
  range: Doc<'messages'>[],
  session: Doc<'sessions'>,
) {
  for (const message of range) {
    if (message.status === 'processing') {
      error('Message is being processed', 409)
    }
    requireDeletableSender(ctx, message, session)
  }
}

async function deleteMessageDoc(
  ctx: AuthMutationCtx,
  message: Doc<'messages'>,
  deferredAvatarIds?: Set<Id<'avatars'>>,
) {
  const attachments = await ctx.db
    .query('attachments')
    .withIndex('by_messageId', (q) => q.eq('messageId', message._id))
    .collect()

  for (const attachment of attachments) {
    await Attachments.removeAttachment(ctx, attachment)
  }

  await deleteVersions(ctx, message._id)
  await ctx.db.delete(message._id)

  const avatarId = message.senderSnapshot?.avatarId
  if (!avatarId) return
  if (deferredAvatarIds) {
    deferredAvatarIds.add(avatarId)
  } else {
    await Avatars.removeIfUnreferenced(ctx, avatarId)
  }
}

async function deleteToolOutput(ctx: AuthMutationCtx, parts: unknown[]) {
  for (const storageId of collectToolOutputStorageIds(parts)) {
    await ctx.storage.delete(storageId).catch(() => {})
  }
}

async function removeAttachmentsForParts(
  ctx: AuthMutationCtx,
  messageId: Id<'messages'>,
  removedParts: unknown[],
) {
  for (const part of removedParts) {
    const attachmentId = filePartAttachmentId(part)
    if (!attachmentId) continue
    const attachment = await ctx.db.get(attachmentId)
    if (attachment && attachment.messageId === messageId) {
      await Attachments.removeAttachment(ctx, attachment)
    }
  }
}

function isEditablePart(
  part: unknown,
): part is { type: 'text' | 'reasoning'; text: string } {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    (part.type === 'text' || part.type === 'reasoning')
  )
}

function filePartAttachmentId(part: unknown): Id<'attachments'> | undefined {
  if (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    part.type === 'file' &&
    'attachmentId' in part
  ) {
    return (part as { attachmentId: Id<'attachments'> }).attachmentId
  }
  return undefined
}

async function requireMessageMutation(
  ctx: AuthMutationCtx,
  messageId: Id<'messages'>,
) {
  const message = await ctx.db.get(messageId)
  if (!message) error('Not found', 404)

  const { session } = await Memberships.requireMember(
    ctx,
    message.sessionId,
    ctx.userId,
  )

  await Memberships.requireNonBlockingStream(ctx, message.sessionId)

  if (session.settings?.disabled && session.ownerId !== ctx.userId) {
    error('Session is disabled', 409)
  }

  if (message.status === 'processing') {
    error('Message is being processed', 409)
  }

  requireDeletableSender(ctx, message, session)

  return { message, session }
}

function requireDeletableSender(
  ctx: Pick<AuthMutationCtx, 'userId' | 'role'>,
  message: Doc<'messages'>,
  session: Doc<'sessions'>,
) {
  if (
    message.sender.type === 'user' &&
    message.sender.id !== ctx.userId &&
    session.ownerId !== ctx.userId &&
    !minRole(ctx.role, 'moderator')
  ) {
    error('Forbidden', 403)
  }
}

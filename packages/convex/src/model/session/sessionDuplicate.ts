import type { Id } from '../../_generated/dataModel'
import { error } from '../../errors'
import { type AuthMutationCtx } from '../../functions'
import * as Attachments from '../attachments'
import { insertMessage, withParts } from '../messageContents'
import { finalizeMessageParts, notACommandChip } from '../messages'
import { getBySession as getPlan, upsert as upsertPlan } from '../plans'
import { getActiveStream, requireOwner } from './memberships'
import { getState, patchState } from './state'

/**
 * Deep copies a conversation into a fresh session owned by the caller.
 * What carries over:
 * - Message history (without versioning)
 * - Linked agents
 * - Bound workspace (if called from api.actions.sessions.duplicate)
 * - Plan
 * - Environment variables
 * - Media
 *
 * Blobs are shared by reference with the source, which is safe because
 * attachment removal is refcount-aware. Large offloaded tool outputs keep
 * pointing at the source's blob and fall back to their preview if the source
 * deletes them.
 */
export async function duplicate(
  ctx: AuthMutationCtx,
  { sessionId, title }: { sessionId: Id<'sessions'>; title?: string },
) {
  const { session } = await requireOwner(ctx, sessionId, ctx.userId)
  if (session.parent) error('Sub-agent sessions cannot be duplicated', 409)
  if (await getActiveStream(ctx, sessionId)) {
    error('Session is busy', 409)
  }

  const now = Date.now()
  const baseTitle =
    title?.trim() || session.title || session.firstMessagePreview || 'New chat'
  const newTitle = `${baseTitle} (copy)`

  const newSessionId = await ctx.db.insert('sessions', {
    ownerId: ctx.userId,
    title: newTitle,
    activeAgentId: session.activeAgentId,
    ...(session.model ? { model: session.model } : {}),
    reasoningEffort: session.reasoningEffort,
    mode: session.mode,
    announcedMode: session.announcedMode,
    // A copy starts enabled even when its source was disabled
    settings: session.settings
      ? { ...session.settings, disabled: undefined }
      : undefined,
    lastMessageAt: now,
    lastMessagePreview: session.lastMessagePreview,
    firstMessagePreview: session.firstMessagePreview,
  })

  await ctx.db.insert('userSessions', {
    sessionId: newSessionId,
    userId: ctx.userId,
    role: 'owner',
    lastMessageAt: now,
    title: newTitle,
  })

  const links = await ctx.db
    .query('sessionAgents')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()
  for (const link of links) {
    await ctx.db.insert('sessionAgents', {
      sessionId: newSessionId,
      agentId: link.agentId,
      addedBy: ctx.userId,
    })
  }

  const plan = await getPlan(ctx, sessionId)
  if (plan) {
    await upsertPlan(ctx, newSessionId, plan.content, {
      status: plan.status,
      dirty: plan.dirty,
    })
  }

  const state = await getState(ctx, sessionId)
  if (state?.environment) {
    await patchState(ctx, newSessionId, { environment: state.environment })
  }

  const messages = await ctx.db
    .query('messages')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .filter(notACommandChip)
    .order('asc')
    .collect()

  const copied = messages.filter((message) => message.status !== 'processing')
  const partsByMessage = new Map<Id<'messages'>, unknown[]>()
  const referencedAttachmentIds = new Set<string>()
  for (const message of copied) {
    const { parts } = await withParts(ctx, message)
    partsByMessage.set(message._id, parts)
    for (const id of Attachments.referencedAttachmentIds(parts)) {
      referencedAttachmentIds.add(id)
    }
  }

  const oldAttachments = await ctx.db
    .query('attachments')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()
  const attachmentMap = new Map<Id<'attachments'>, Id<'attachments'>>()
  for (const attachment of oldAttachments) {
    if (!referencedAttachmentIds.has(attachment._id)) continue
    const copyId = await ctx.db.insert('attachments', {
      fileId: attachment.fileId,
      storageId: attachment.storageId,
      previewStorageId: attachment.previewStorageId,
      uploaderId: attachment.uploaderId,
      sessionId: newSessionId,
      filename: attachment.filename,
      mediaType: attachment.mediaType,
    })
    attachmentMap.set(attachment._id, copyId)
  }

  const attachmentCopyByMessage = new Map<Id<'messages'>, Id<'attachments'>>()
  for (const attachment of oldAttachments) {
    const copyId = attachmentMap.get(attachment._id)
    if (attachment.messageId && copyId) {
      attachmentCopyByMessage.set(attachment.messageId, copyId)
    }
  }

  const messageIdMap = new Map<Id<'messages'>, Id<'messages'>>()
  for (const message of copied) {
    const parts = Attachments.remapPartAttachmentIds(
      partsByMessage.get(message._id) ?? [],
      attachmentMap,
    )

    const { messageId } = await insertMessage(
      ctx,
      {
        sessionId: newSessionId,
        sender: message.sender,
        role: message.role,
        type: message.type,
        status: 'done',
        hidden: message.hidden,
        extra: message.extra,
        metadata: message.metadata,
        senderName: message.senderName,
        senderAvatarId: message.senderAvatarId,
        appearanceId: message.appearanceId,
      },
      finalizeMessageParts(parts),
    )
    messageIdMap.set(message._id, messageId)
  }

  for (const [oldId, newId] of messageIdMap) {
    const copyId = attachmentCopyByMessage.get(oldId)
    if (copyId) await ctx.db.patch(copyId, { messageId: newId })
  }

  return { sessionId: newSessionId }
}

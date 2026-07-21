import type { MessageRole } from '@sb/core/types/roles'
import type { Infer } from 'convex/values'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import { findUserBySubject } from '../../functions'
import type {
  importSessionArgsValidator,
  sessionArchiveValidator,
} from '../../validators'
import {
  type MessageWithParts,
  insertMessage,
  withPartsMany,
} from '../messageContents'
import {
  finalizeMessageParts,
  notACommandChip,
  textFromParts,
} from '../messages'
import { getMember } from './memberships'
import { resolveTitle } from './title'

export type SessionArchive = Infer<typeof sessionArchiveValidator>

export type ImportSessionArgs = Infer<typeof importSessionArgsValidator>

export type SessionArchiveMessage =
  SessionArchive['session']['messages'][number]

export type SessionArchiveExportData = {
  archive: SessionArchive
  avatars: Array<{
    key: string
    storageId: Id<'_storage'>
  }>
}

export async function exportOne(
  ctx: QueryCtx,
  {
    sessionId,
    subject,
  }: {
    sessionId: Id<'sessions'>
    subject: string
  },
): Promise<SessionArchiveExportData> {
  const user = await findUserBySubject(ctx, subject)
  if (!user) error('Profile not initialized', 409)

  const member = await getMember(ctx, sessionId, user._id)
  if (!member) error('Not found', 404)

  const messages = await ctx.db
    .query('messages')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .filter(notACommandChip)
    .order('asc')
    .collect()

  const avatars = await collectAvatars(ctx, messages)
  const messagesWithParts = await withPartsMany(ctx, messages)

  return {
    archive: {
      version: 1,
      exportedAt: Date.now(),
      session: {
        title: resolveTitle(member.session.title, messagesWithParts),
        messages: messagesWithParts.map(exportMessage),
      },
    },
    avatars,
  }
}

export async function importOne(
  ctx: MutationCtx,
  { payload, subject, avatars }: ImportSessionArgs,
) {
  const user = await findUserBySubject(ctx, subject)
  if (!user) error('Profile not initialized', 409)

  const avatarIds = await createAvatars(ctx, avatars)
  const now = Date.now()
  const title = payload.session.title.trim() || 'Imported chat'
  const imported = payload.session.messages.map(
    importMessage(user._id, avatarIds),
  )
  const lastMessage = imported.at(-1)
  const preview = lastMessage ? textFromParts(lastMessage.parts).trim() : ''

  const sessionId = await ctx.db.insert('sessions', {
    ownerId: user._id,
    title,
    lastMessageAt: now,
    lastMessagePreview: preview ? preview.slice(0, 140) : undefined,
  })

  await ctx.db.insert('userSessions', {
    sessionId,
    userId: user._id,
    role: 'owner',
    lastMessageAt: now,
    title,
  })

  for (const { fields, parts } of imported) {
    await insertMessage(ctx, { ...fields, sessionId }, parts)
  }

  return { sessionId }
}

async function createAvatars(
  ctx: MutationCtx,
  avatars: Record<string, Id<'_storage'>>,
): Promise<Record<string, Id<'avatars'>>> {
  const entries = await Promise.all(
    Object.entries(avatars).map(async ([key, storageId]) => {
      const avatarId = await ctx.db.insert('avatars', {
        storageId,
        thumbStorageId: storageId,
      })
      return [key, avatarId] as const
    }),
  )

  return Object.fromEntries(entries)
}

async function collectAvatars(
  ctx: QueryCtx,
  messages: Doc<'messages'>[],
): Promise<SessionArchiveExportData['avatars']> {
  const avatarIds = [
    ...new Set(
      messages.flatMap((message) =>
        message.senderSnapshot?.avatarId
          ? [message.senderSnapshot.avatarId]
          : [],
      ),
    ),
  ]

  const avatars = await Promise.all(
    avatarIds.map(async (avatarId) => {
      const avatar = await ctx.db.get(avatarId)
      return avatar ? { key: avatarId, storageId: avatar.storageId } : null
    }),
  )

  return avatars.filter((avatar): avatar is NonNullable<typeof avatar> =>
    Boolean(avatar),
  )
}

function exportMessage(message: MessageWithParts): SessionArchiveMessage {
  return {
    role: message.role,
    type: message.type,
    hidden: message.hidden,
    extra: message.extra,
    parts: sanitizeParts(finalizeMessageParts(message.parts)),
    senderSnapshot: sanitizeSnapshot(message.senderSnapshot),
    metadata: message.metadata,
  }
}

function importMessage(
  userId: Id<'users'>,
  avatars: Record<string, Id<'avatars'>>,
) {
  return (message: SessionArchiveMessage) => {
    const parts = sanitizeParts(finalizeMessageParts(message.parts))

    return {
      fields: {
        sender: { type: 'user' as const, id: userId },
        role: message.role as MessageRole,
        senderSnapshot:
          message.role === 'system'
            ? undefined
            : importSnapshot(message.senderSnapshot, avatars),
        type: message.type,
        hidden: message.hidden,
        extra: message.extra,
        status: 'done' as const,
        metadata: message.metadata,
      },
      parts,
    }
  }
}

function sanitizeSnapshot(snapshot: Doc<'messages'>['senderSnapshot']) {
  if (!snapshot) return undefined
  return {
    name: snapshot.name,
    avatarKey: snapshot.avatarId,
    css: snapshot.css,
    theme: snapshot.theme,
  }
}

function importSnapshot(
  snapshot: SessionArchiveMessage['senderSnapshot'],
  avatars: Record<string, Id<'avatars'>>,
) {
  if (!snapshot) return undefined
  return {
    name: snapshot.name,
    avatarId: snapshot.avatarKey ? avatars[snapshot.avatarKey] : undefined,
    css: snapshot.css,
    theme: snapshot.theme,
  }
}

function sanitizeParts(parts: unknown[]) {
  return parts.map((part) => {
    if (!isRecord(part) || part.type !== 'file') return part

    const filename =
      typeof part.filename === 'string' && part.filename.trim()
        ? part.filename.trim()
        : 'attachment'

    return {
      type: 'text',
      text: `[Attachment omitted: ${filename}]`,
    }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

import type { Id } from '../../_generated/dataModel'
import { error } from '../../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../../functions'
import { listVersionHeads, setSelectedVersion } from '../messageContents'
import { textFromParts } from '../messages'
import * as Memberships from '../session/memberships'
import { reserveRetryStream } from './reserve'
import { latestMessageBefore } from './send'

const PREVIEW_LENGTH = 280

/** Regenerates an agent message in place as a new version. */
export async function retryMessage(
  ctx: AuthMutationCtx,
  { messageId }: { messageId: Id<'messages'> },
) {
  const message = await ctx.db.get(messageId)
  if (!message) error('Not found', 404)

  const { session } = await Memberships.requireMember(
    ctx,
    message.sessionId,
    ctx.userId,
  )
  Memberships.requireEnabled(session)

  if (await Memberships.getActiveStream(ctx, message.sessionId)) {
    error('Session is busy', 409)
  }
  if (message.status === 'processing') {
    error('Message is being processed', 409)
  }
  if (
    message.role !== 'assistant' ||
    message.type === 'summary' ||
    message.sender.type !== 'agent'
  ) {
    error('Only agent messages can be retried', 400)
  }

  const boundary = await latestMessageBefore(
    ctx,
    message.sessionId,
    message._creationTime,
  )

  return reserveRetryStream(ctx, {
    sessionId: message.sessionId,
    agentId: message.sender.id,
    invokedBy: ctx.userId,
    messageId: message._id,
    boundaryId: boundary?._id,
  })
}

/** Points a message at a different version. */
export async function selectMessageVersion(
  ctx: AuthMutationCtx,
  { messageId, version }: { messageId: Id<'messages'>; version: number },
) {
  const message = await ctx.db.get(messageId)
  if (!message) error('Not found', 404)

  await Memberships.requireMember(ctx, message.sessionId, ctx.userId)

  if (await Memberships.getActiveStream(ctx, message.sessionId)) {
    error('Session is busy', 409)
  }
  if (message.status === 'processing') {
    error('Message is being processed', 409)
  }
  if (version < 1 || version > message.versionCount) {
    error('Invalid version', 400)
  }
  if (version === message.selectedVersion) return

  await setSelectedVersion(ctx, message, version)
}

export type MessageVersionSummary = {
  version: number
  preview: string
  selected: boolean
}

/** Lists a message's versions with text previews for the switcher UI. */
export async function listMessageVersions(
  ctx: AuthQueryCtx,
  { messageId }: { messageId: Id<'messages'> },
): Promise<MessageVersionSummary[]> {
  const message = await ctx.db.get(messageId)
  if (!message) return []

  const member = await Memberships.getMember(ctx, message.sessionId, ctx.userId)
  if (!member) return []

  const rows = await listVersionHeads(ctx, message)
  return rows.map((row) => ({
    version: row.version,
    preview: textFromParts(row.parts).trim().slice(0, PREVIEW_LENGTH),
    selected: row.version === message.selectedVersion,
  }))
}

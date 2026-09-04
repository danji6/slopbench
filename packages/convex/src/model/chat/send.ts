import { parseFileMentions } from '@sb/core/mentions/parse'
import { parseShellCommand, unescapeShellPrefix } from '@sb/core/shell/command'
import type { WorkspaceLinkSnapshot } from '@sb/core/types/workspace'
import { clampLinkSnapshot } from '@sb/core/workspace/snapshot'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import type { SendMessageArgs } from '../../types'
import { insertMessage } from '../messageContents'
import { scheduleMessageEval, syncActivity } from '../messages'
import { notifyUserMessage } from '../notifications'
import {
  type PlanLinkPart,
  createPlanLinkPart,
  getBySession as getPlan,
} from '../plans'
import * as Memberships from '../session/memberships'
import { get as getSettings } from '../settings'
import { resolveSender } from './identities'
import { injectDueReminders } from './reminders'
import {
  latestMessageId,
  reserveOrDebounceTurn,
  reserveResumableStream,
  reserveStream,
} from './reserve'
import { runShellCommand } from './shell'
import { maybeInsertStarters } from './starters'

export async function sendMessage(ctx: AuthMutationCtx, args: SendMessageArgs) {
  const { session, membership } = await Memberships.requireMember(
    ctx,
    args.sessionId,
    ctx.userId,
  )

  Memberships.requireEnabled(session)

  const role = args.role ?? 'user'
  const now = Date.now()

  // Slow mode: each user may only send once per configured interval
  if (role === 'user') {
    const remainingMs = slowModeRemainingMs(
      membership,
      session.settings?.slowModeMs,
      now,
    )
    if (remainingMs > 0) {
      error(`Slow mode: wait ${Math.ceil(remainingMs / 1000)}s`, 429)
    }
  }

  const activeStream = await Memberships.requireNonBlockingStream(
    ctx,
    args.sessionId,
  )
  const attachments = await loadStagedAttachments(ctx, args)

  if (!args.content.trim() && attachments.length === 0) {
    error('Message is empty')
  }

  const settings = await getSettings(ctx)

  await maybeInsertStarters(ctx, session)
  await injectDueReminders(ctx, session, ctx.userId)

  const silent = args.silent ?? false

  const command = role === 'user' ? parseShellCommand(args.content) : null
  if (command !== null) {
    return runShellCommand(ctx, {
      session,
      membership,
      settings,
      command,
      silent,
      hasAttachments: attachments.length > 0,
    })
  }

  const content = unescapeShellPrefix(args.content)

  const fileLinkParts = session.workspace
    ? snapshotFileLinkParts(parseFileMentions(content), args.fileLinks)
    : []

  const parts = [
    ...(await dirtyPlanLinkParts(ctx, args.sessionId)),
    ...attachments.map(({ attachment }) => ({
      type: 'file',
      url: `attachment:${attachment._id}`,
      attachmentId: attachment._id,
      mediaType: attachment.mediaType,
      filename: attachment.filename,
    })),
    ...fileLinkParts,
    ...(content.trim() ? [{ type: 'text', text: content.trim() }] : []),
  ]

  const { sender, identity } = await resolveSender(ctx, {
    role,
    session,
    settings,
  })

  const { messageId, segments } = await insertMessage(
    ctx,
    {
      sessionId: args.sessionId,
      sender,
      role,
      ...identity,
      status: 'done',
    },
    parts,
  )

  for (const { attachment } of attachments) {
    await ctx.db.patch(attachment._id, { messageId })
  }

  // A long send may comprise several segments, each evaluated on its own row
  for (const [segmentIndex, segmentParts] of segments.entries()) {
    await scheduleMessageEval(ctx, {
      messageId,
      invokerId: ctx.userId,
      parts: segmentParts,
      version: 1,
      segmentIndex,
    })
  }
  await syncActivity(ctx, args.sessionId, parts)

  if (sender.type === 'user') {
    await notifyUserMessage(ctx, {
      sessionId: args.sessionId,
      senderId: sender.id,
      actorName: identity.senderName ?? 'User',
      actorAvatarId: identity.senderAvatarId,
      preview: content.trim() || 'Sent an attachment',
      sourceMessageId: messageId,
    })
  }

  if (role === 'user') {
    await ctx.db.patch(membership._id, { lastSendAt: now })
  }

  await reserveOrDebounceTurn(ctx, {
    session,
    messageId,
    invokedBy: ctx.userId,
    silent,
    activeStream,
  })

  return messageId
}

export async function invokeAgent(
  ctx: AuthMutationCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  const { session } = await Memberships.requireMember(
    ctx,
    sessionId,
    ctx.userId,
  )

  Memberships.requireEnabled(session)
  await Memberships.requireNonBlockingStream(ctx, sessionId)

  if (await Memberships.getActiveStream(ctx, sessionId)) return null
  if (!session.activeAgentId) error('No active agent', 409)

  await maybeInsertStarters(ctx, session)

  return reserveStream(ctx, {
    sessionId,
    agentId: session.activeAgentId,
    invokedBy: ctx.userId,
    boundaryId: await latestMessageId(ctx, sessionId),
    operation: 'invoke',
  })
}

export async function executeResume(
  ctx: MutationCtx,
  session: Doc<'sessions'>,
  invokedBy: Id<'users'>,
) {
  const sessionId = session._id

  const message = await latestResumableAgentMessage(ctx, sessionId)
  if (!message) error('No agent message to continue', 404)
  if (message.sender.type !== 'agent') {
    error('Assistant message has no original agent', 409)
  }

  const boundary = await latestMessageBefore(
    ctx,
    sessionId,
    message._creationTime,
  )

  return reserveResumableStream(ctx, {
    sessionId,
    agentId: message.sender.id,
    invokedBy,
    messageId: message._id,
    boundaryId: boundary?._id,
    suppressFollowUp: true,
  })
}

export async function executeCompact(
  ctx: MutationCtx,
  session: Doc<'sessions'>,
  invokedBy: Id<'users'>,
  instructions?: string,
  options?: {
    boundaryId?: Id<'messages'>
    preserveContextBoundary?: boolean
    followUpAfterCompact?: boolean
    autoCompact?: boolean
  },
) {
  if (!session.activeAgentId) error('No active agent', 409)

  return reserveStream(ctx, {
    sessionId: session._id,
    agentId: session.activeAgentId,
    invokedBy,
    boundaryId: options?.boundaryId ?? (await latestMessageId(ctx, session._id)), // prettier-ignore
    operation: 'compact',
    instructions,
    preserveContextBoundary: options?.preserveContextBoundary,
    followUpAfterCompact: options?.followUpAfterCompact,
    autoCompact: options?.autoCompact,
  })
}

export async function executeImpersonate(
  ctx: MutationCtx,
  session: Doc<'sessions'>,
  invokedBy: Id<'users'>,
  instructions?: string,
) {
  if (!session.activeAgentId) error('No active agent', 409)

  return reserveStream(ctx, {
    sessionId: session._id,
    agentId: session.activeAgentId,
    invokedBy,
    boundaryId: await latestMessageId(ctx, session._id),
    operation: 'impersonate',
    instructions,
  })
}

async function loadStagedAttachments(
  ctx: AuthMutationCtx,
  args: SendMessageArgs,
) {
  const staged = []
  for (const { id } of args.attachments ?? []) {
    const attachment = await ctx.db.get(id)
    if (
      !attachment ||
      attachment.sessionId !== args.sessionId ||
      attachment.uploaderId !== ctx.userId ||
      attachment.messageId
    ) {
      error('Invalid staged attachment', 409)
    }
    staged.push({ attachment })
  }
  return staged
}

type SnapshotLink = WorkspaceLinkSnapshot<Id<'_storage'>>
type ResolvedFileLink = { path: string; snapshot?: SnapshotLink }
type FileLinkPart = { type: 'file-link'; path: string; snapshot?: SnapshotLink }

/** A manual user edit marks the plan dirty and the next send injects it again. */
async function dirtyPlanLinkParts(
  ctx: AuthMutationCtx,
  sessionId: Id<'sessions'>,
): Promise<PlanLinkPart[]> {
  const plan = await getPlan(ctx, sessionId)
  if (!plan?.dirty) return []

  await ctx.db.patch(plan._id, { dirty: false })
  return [createPlanLinkPart(plan)]
}

function snapshotFileLinkParts(
  mentionPaths: string[],
  resolved: ResolvedFileLink[] | undefined,
): FileLinkPart[] {
  if (resolved) return resolvedFileLinkParts(resolved)
  return [...new Set(mentionPaths)].map((path) => ({ type: 'file-link', path }))
}

function resolvedFileLinkParts(resolved: ResolvedFileLink[]): FileLinkPart[] {
  const seen = new Set<string>()
  const parts: FileLinkPart[] = []
  for (const { path, snapshot: raw } of resolved) {
    // Reapply the cap instead of trusting the client
    const snapshot = raw ? clampLinkSnapshot(raw) : undefined
    const canonical = snapshot?.path ?? path
    if (seen.has(canonical)) continue
    seen.add(canonical)
    parts.push(
      snapshot
        ? { type: 'file-link', path: canonical, snapshot }
        : { type: 'file-link', path: canonical },
    )
  }
  return parts
}

async function latestResumableAgentMessage(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
) {
  const messages = await ctx.db
    .query('messages')
    .withIndex('by_sessionId_status_contextEligible', (q) =>
      q
        .eq('sessionId', sessionId)
        .eq('status', 'done')
        .eq('contextEligible', true),
    )
    .order('desc')
    .collect()

  return messages.find(
    (message) =>
      message.role === 'assistant' &&
      message.type !== 'summary' &&
      message.sender.type === 'agent',
  )
}

export async function latestMessageBefore(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  creationTime: number,
) {
  return ctx.db
    .query('messages')
    .withIndex('by_sessionId_status_contextEligible', (q) =>
      q
        .eq('sessionId', sessionId)
        .eq('status', 'done')
        .eq('contextEligible', true)
        .lt('_creationTime', creationTime),
    )
    .order('desc')
    .first()
}

/** Milliseconds the member must still wait before sending again under slow mode. */
export function slowModeRemainingMs(
  membership: { lastSendAt?: number },
  slowModeMs: number | undefined,
  now: number,
): number {
  return !slowModeMs || slowModeMs <= 0 || !membership.lastSendAt
    ? 0
    : Math.max(0, membership.lastSendAt + slowModeMs - now)
}

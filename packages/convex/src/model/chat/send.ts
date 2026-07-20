import { parseFileMentions } from '@sb/core/mentions/parse'
import type { WorkspaceLinkSnapshot } from '@sb/core/types/workspace'

import type { Id } from '../../_generated/dataModel'
import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import type { SendMessageArgs } from '../../types'
import { insertMessage } from '../messageContents'
import { scheduleMessageEval, scheduleTitle, syncActivity } from '../messages'
import {
  type PlanLinkPart,
  createPlanLinkPart,
  getBySession as getPlan,
} from '../plans'
import * as Memberships from '../session/memberships'
import { get as getSettings } from '../settings'
import { resolveSender } from './identities'
import { bumpTurnCount, injectDueReminders } from './reminders'
import {
  latestMessageId,
  rescheduleStream,
  reserveResumableStream,
  reserveStream,
} from './reserve'
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
      session.settings?.slowModeSeconds,
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

  const fileLinkParts = session.workspace
    ? snapshotFileLinkParts(parseFileMentions(args.content), args.fileLinks)
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
    ...(args.content.trim()
      ? [{ type: 'text', text: args.content.trim() }]
      : []),
  ]

  const { sender, senderSnapshot } = await resolveSender(ctx, {
    role,
    session,
    settings,
  })

  const { messageId } = await insertMessage(
    ctx,
    {
      sessionId: args.sessionId,
      sender,
      role,
      senderSnapshot,
      status: 'done',
    },
    parts,
  )

  for (const { attachment } of attachments) {
    await ctx.db.patch(attachment._id, { messageId })
  }

  await bumpTurnCount(ctx, args.sessionId)

  await scheduleMessageEval(ctx, {
    messageId,
    invokerId: ctx.userId,
    parts,
    version: 1,
    segmentIndex: 0,
  })
  await syncActivity(ctx, args.sessionId, parts)

  if (role === 'user') {
    await ctx.db.patch(membership._id, { lastSendAt: now })
  }

  const debounceMs = (session.settings?.agentDebounceSeconds ?? 0) * 1000
  const willStream = activeStream || (!silent && !!session.activeAgentId)

  if (!silent && session.activeAgentId && !activeStream) {
    await reserveStream(ctx, {
      sessionId: args.sessionId,
      agentId: session.activeAgentId,
      invokedBy: ctx.userId,
      boundaryId: messageId,
      operation: 'invoke',
      delayMs: debounceMs,
    })
  } else if (
    debounceMs > 0 &&
    activeStream &&
    activeStream.status === 'pending' &&
    activeStream.operation === 'invoke' &&
    activeStream.fireAt
  ) {
    // Debounce: new messages reschedule the pending turn
    await rescheduleStream(ctx, activeStream, {
      boundaryId: messageId,
      delayMs: debounceMs,
    })
  }

  if (!willStream) await scheduleTitle(ctx, args.sessionId)

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

export async function resumeAgentMessage(
  ctx: AuthMutationCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  const { session } = await Memberships.requireMember(
    ctx,
    sessionId,
    ctx.userId,
  )

  Memberships.requireEnabled(session)

  if (await Memberships.getActiveStream(ctx, sessionId)) {
    error('Session is busy', 409)
  }

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
    invokedBy: ctx.userId,
    messageId: message._id,
    boundaryId: boundary?._id,
    suppressFollowUp: true,
  })
}

export async function compact(
  ctx: AuthMutationCtx,
  args: { sessionId: Id<'sessions'>; extraInstructions?: string },
) {
  const { session } = await Memberships.requireMember(
    ctx,
    args.sessionId,
    ctx.userId,
  )

  Memberships.requireEnabled(session)

  if (await Memberships.getActiveStream(ctx, args.sessionId)) {
    error('Session is busy', 409)
  }

  if (!session.activeAgentId) error('No active agent', 409)

  return reserveStream(ctx, {
    sessionId: args.sessionId,
    agentId: session.activeAgentId,
    invokedBy: ctx.userId,
    boundaryId: await latestMessageId(ctx, args.sessionId),
    operation: 'compact',
    instructions: args.extraInstructions,
  })
}

export async function impersonate(
  ctx: AuthMutationCtx,
  {
    sessionId,
    extraInstructions,
  }: { sessionId: Id<'sessions'>; extraInstructions?: string },
) {
  const { session } = await Memberships.requireMember(
    ctx,
    sessionId,
    ctx.userId,
  )

  Memberships.requireEnabled(session)

  if (await Memberships.getActiveStream(ctx, sessionId)) {
    error('Session is busy', 409)
  }

  if (!session.activeAgentId) error('No active agent', 409)

  return reserveStream(ctx, {
    sessionId,
    agentId: session.activeAgentId,
    invokedBy: ctx.userId,
    boundaryId: await latestMessageId(ctx, sessionId),
    operation: 'impersonate',
    instructions: extraInstructions,
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
  for (const { path, snapshot } of resolved) {
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
  ctx: AuthMutationCtx,
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
  ctx: AuthMutationCtx,
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
  slowModeSeconds: number | undefined,
  now: number,
): number {
  return !slowModeSeconds || slowModeSeconds <= 0 || !membership.lastSendAt
    ? 0
    : Math.max(0, membership.lastSendAt + slowModeSeconds * 1000 - now)
}

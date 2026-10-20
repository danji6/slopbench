import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { agentIdentity } from '../chat/identities'
import { injectModeNote } from '../chat/notes'
import { injectDueReminders } from '../chat/reminders'
import { insertMessage } from '../messageContents'
import { notACommandChip, notAUserKilledReport } from '../messages'
import { getSessionWithWorkspace } from '../session/folderContext'
import { scheduleStream } from './execution'
import { STREAM_LEASE_MS } from './lifecycleClaims'

export async function reserveFollowUp(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
): Promise<boolean> {
  const session = await getSessionWithWorkspace(ctx, stream.sessionId)
  if (!session) return false

  const boundaryMessage = await earliestUnconsumedMessage(ctx, stream)
  if (!boundaryMessage) return false

  return Boolean(
    await reserveInvokeTurn(ctx, {
      sessionId: stream.sessionId,
      boundaryMessage,
      invokedBy: stream.invokedBy,
    }),
  )
}

/** The earliest user/sub-agent message the completed turn did not consume. */
export async function earliestUnconsumedMessage(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
): Promise<Doc<'messages'> | null> {
  const boundary = stream.contextBoundaryCreationTime ?? 0

  const lateUserMessage = await ctx.db
    .query('messages')
    .withIndex('by_sessionId_senderType', (q) =>
      q
        .eq('sessionId', stream.sessionId)
        .eq('sender.type', 'user')
        .gt('_creationTime', boundary),
    )
    .filter(notACommandChip)
    .order('asc')
    .first()

  // Sub-agent reports
  const lateReport = await ctx.db
    .query('messages')
    .withIndex('by_sessionId_senderType', (q) =>
      q
        .eq('sessionId', stream.sessionId)
        .eq('sender.type', 'agent')
        .gt('_creationTime', boundary),
    )
    .filter((q) => q.eq(q.field('role'), 'user'))
    .filter(notAUserKilledReport)
    .order('asc')
    .first()

  if (!lateUserMessage || !lateReport) return lateUserMessage ?? lateReport
  return lateUserMessage._creationTime < lateReport._creationTime
    ? lateUserMessage
    : lateReport
}

export type ReserveInvokeTurnArgs = {
  sessionId: Id<'sessions'>
  boundaryMessage: Doc<'messages'>
  invokedBy: Id<'users'>
}

/**
 * Reserves and schedules a fresh invoke turn for the session's active agent,
 * with the given message as the context boundary. Used for follow-ups on
 * unconsumed user messages and for waking a parent on a sub-agent report.
 */
export async function reserveInvokeTurn(
  ctx: MutationCtx,
  { sessionId, boundaryMessage, invokedBy }: ReserveInvokeTurnArgs,
) {
  const session = await getSessionWithWorkspace(ctx, sessionId)
  if (!session) return
  if (session.contextLock) return
  if (session.settings?.disabled) return
  if (!session.activeAgentId) return

  const agent = await ctx.db.get(session.activeAgentId)
  if (!agent || agent.fileOperationId) return
  if (agent.homeId && (await ctx.db.get(agent.homeId))?.operationId) return

  const link = await ctx.db
    .query('sessionAgents')
    .withIndex('by_sessionId_agentId', (q) =>
      q.eq('sessionId', session._id).eq('agentId', agent._id),
    )
    .unique()
  if (!link) return

  await injectModeNote(ctx, session, invokedBy)
  await injectDueReminders(ctx, session, invokedBy)

  const { messageId: processingMessageId, contentId } = await insertMessage(
    ctx,
    {
      sessionId: session._id,
      sender: { type: 'agent', id: agent._id },
      role: 'assistant',
      ...agentIdentity(agent),
      status: 'processing',
    },
    [],
  )

  const nextStreamId = await ctx.db.insert('streams', {
    generation: 0,
    sessionId: session._id,
    agentId: agent._id,
    invokedBy,
    state: {
      phase: 'reserved',
      processingMessageId,
      processingContentId: contentId,
    },
    contextBoundaryMessageId: boundaryMessage._id,
    contextBoundaryCreationTime: boundaryMessage._creationTime,
    command: { kind: 'invoke' },
    attempt: 0,
    leaseExpiresAt: Date.now() + STREAM_LEASE_MS,
  })

  await scheduleStream(ctx, nextStreamId)
}

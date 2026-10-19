import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import type { PrepareContextNoteArgs, RunningStream } from '../../types'
import { agentIdentity } from '../chat/identities'
import { insertMessage } from '../messageContents'
import { ownsExecution } from '../stream/execution'

/** Records immutable context once per logical invocation, including retries. */
export async function prepareContextNote(
  ctx: MutationCtx,
  args: PrepareContextNoteArgs,
  type: 'skills' | 'workspace',
) {
  const stream = await ctx.db.get(args.streamId)
  if (!ownsExecution(stream, args)) return false

  const prepared =
    type === 'skills'
      ? stream.skillContextPrepared
      : stream.workspaceContextPrepared
  if (prepared) return true

  const user = await ctx.db.get(stream.invokedBy)
  const agent = await ctx.db.get(stream.agentId)
  if (!agent || !user) return false

  const previous = await latestContext(ctx, stream, type)
  const unchanged = matchesContext(previous, stream.agentId, args.fingerprint)
  const noteId = unchanged
    ? undefined
    : await insertContextNote(ctx, stream, agent, args, type)

  await ctx.db.patch(
    stream._id,
    type === 'skills'
      ? {
          skillContextPrepared: true,
          skillContextMessageId: noteId,
        }
      : { workspaceContextPrepared: true, workspaceContextMessageId: noteId },
  )

  return true
}

function matchesContext(
  previous: Doc<'messages'> | null,
  agentId: Id<'agents'>,
  fingerprint: string,
) {
  if (previous?.sender.id !== agentId || !previous.extra) return false
  return (
    'fingerprint' in previous.extra &&
    previous.extra.fingerprint === fingerprint
  )
}

async function insertContextNote(
  ctx: MutationCtx,
  stream: RunningStream,
  agent: Doc<'agents'>,
  args: PrepareContextNoteArgs,
  type: 'skills' | 'workspace',
) {
  const { messageId } = await insertMessage(
    ctx,
    {
      sessionId: stream.sessionId,
      sender: { type: 'agent', id: stream.agentId },
      ...agentIdentity(agent),
      role: 'system',
      status: 'done',
      hidden: true,
      type,
      extra: {
        fingerprint: args.fingerprint,
        anchorMessageId: stream.state.processingMessageId,
        ...(type === 'workspace' && { label: args.label }),
      },
    },
    [{ type: 'text', text: args.content }],
  )
  return messageId
}

async function latestContext(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
  type: 'skills' | 'workspace',
) {
  const upper = stream.contextBoundaryCreationTime ?? Number.MAX_SAFE_INTEGER
  const floor = await summaryFloor(ctx, stream.sessionId, upper)
  return ctx.db
    .query('messages')
    .withIndex('by_sessionId_type_status', (q) =>
      q.eq('sessionId', stream.sessionId).eq('type', type).eq('status', 'done'),
    )
    .filter((q) =>
      q.and(
        q.eq(q.field('contextEligible'), true),
        q.gt(q.field('_creationTime'), floor),
        q.lte(q.field('_creationTime'), upper),
      ),
    )
    .order('desc')
    .first()
}

async function summaryFloor(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  upper: number,
) {
  const summary = await ctx.db
    .query('messages')
    .withIndex('by_sessionId_type_status', (q) =>
      q.eq('sessionId', sessionId).eq('type', 'summary').eq('status', 'done'),
    )
    .filter((q) =>
      q.and(
        q.eq(q.field('contextEligible'), true),
        q.lte(q.field('_creationTime'), upper),
      ),
    )
    .order('desc')
    .first()
  return summary?.summaryBoundaryCreationTime ?? summary?._creationTime ?? 0
}

/** Places each note before the assistant output whose request first consumed it. */
export function orderContextNotes<
  T extends Pick<Doc<'messages'>, '_id' | 'type' | 'extra'>,
>(messages: T[]): T[] {
  const anchored = new Map<string, T[]>()
  const ids = new Set(messages.map((message) => message._id))
  const remaining = messages.filter((message) => {
    const anchor = contextNoteAnchor(message)
    if (!anchor || !ids.has(anchor)) return true
    anchored.set(anchor, [...(anchored.get(anchor) ?? []), message])
    return false
  })
  return remaining.flatMap((message) => [
    ...(anchored.get(message._id) ?? []),
    message,
  ])
}

function contextNoteAnchor(message: Pick<Doc<'messages'>, 'type' | 'extra'>) {
  if (!isContextNote(message.type) || !message.extra) return undefined
  if (!('anchorMessageId' in message.extra)) return undefined
  return message.extra.anchorMessageId
}

/** Identifies immutable context prepared before a provider invocation. */
export function isContextNote(type: Doc<'messages'>['type']) {
  return type === 'skills' || type === 'workspace'
}

/** Removes local ordering references when copying an already ordered transcript. */
export function portableContextExtra(
  message: Pick<Doc<'messages'>, 'type' | 'extra'>,
) {
  if (
    !isContextNote(message.type) ||
    !message.extra ||
    !('anchorMessageId' in message.extra)
  )
    return message.extra
  const { anchorMessageId: _anchor, ...extra } = message.extra
  return extra
}

/** Records the resolved filesystem context without rewriting the request prefix. */
export async function prepareWorkspaceContext(
  ctx: MutationCtx,
  args: PrepareContextNoteArgs,
) {
  return prepareContextNote(ctx, args, 'workspace')
}

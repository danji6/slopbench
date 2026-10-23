import { isContextNote } from '@sb/core/context-notes'
import { systemReminder } from '@sb/core/utils/blocks'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import type { PrepareContextNoteArgs, RunningStream } from '../../types'
import { agentIdentity } from '../chat/identities'
import { WORKSPACE_CHANGE_GUIDANCE } from '../chat/notes'
import { insertMessage } from '../messageContents'
import { ownsExecution } from '../stream/execution'

type ContextType = 'skills' | 'workspace' | 'mcp'

/** Records immutable context while deduplicating retries and unchanged snapshots. */
export async function prepareContextNote(
  ctx: MutationCtx,
  args: PrepareContextNoteArgs,
  type: ContextType,
) {
  const stream = await ctx.db.get(args.streamId)
  if (!ownsExecution(stream, args)) return false

  if (contextPrepared(stream, args, type)) return true

  const user = await ctx.db.get(stream.invokedBy)
  const agent = await ctx.db.get(stream.agentId)
  if (!agent || !user) return false

  const previous = await latestContext(ctx, stream, type)
  const unchanged = matchesContext(previous, stream.agentId, args.fingerprint)
  const content = contextNoteContent(args.content, type, previous)
  const noteId = unchanged
    ? undefined
    : await insertContextNote(ctx, stream, agent, { ...args, content }, type)

  await ctx.db.patch(stream._id, {
    ...contextPatch(type, args.fingerprint, noteId),
    ...(type === 'skills' && {
      skillIntegrationFingerprint: args.integrationFingerprint,
    }),
  })

  return true
}

function contextPrepared(
  stream: Doc<'streams'>,
  args: PrepareContextNoteArgs,
  type: ContextType,
) {
  if (type === 'mcp') return stream.mcpContextFingerprint === args.fingerprint
  return type === 'skills'
    ? stream.skillContextPrepared &&
        stream.skillIntegrationFingerprint === args.integrationFingerprint
    : stream.workspaceContextPrepared
}

function contextPatch(
  type: ContextType,
  fingerprint: string,
  noteId?: Id<'messages'>,
) {
  switch (type) {
    case 'mcp':
      return { mcpContextFingerprint: fingerprint, mcpContextMessageId: noteId }
    case 'skills':
      return { skillContextPrepared: true, skillContextMessageId: noteId }
    case 'workspace':
      return {
        workspaceContextPrepared: true,
        workspaceContextMessageId: noteId,
      }
  }
}

/** Preserves the source transition guidance when replacing an earlier context. */
function contextNoteContent(
  content: string,
  type: ContextType,
  previous: Doc<'messages'> | null,
) {
  if (type !== 'workspace' || !previous) return content
  return `${content}\n\n${systemReminder(WORKSPACE_CHANGE_GUIDANCE)}`
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
  type: ContextType,
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
  type: ContextType,
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

export async function prepareMcpContext(
  ctx: MutationCtx,
  args: PrepareContextNoteArgs,
) {
  return prepareContextNote(ctx, args, 'mcp')
}

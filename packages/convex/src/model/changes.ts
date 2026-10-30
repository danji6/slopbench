import type { PaginationOptions } from 'convex/server'

import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { error } from '../errors'
import {
  type AuthMutationCtx,
  type AuthQueryCtx,
  requireRole,
} from '../functions'
import type {
  AppendChangesArgs,
  PrepareChangesArgs,
  PublishChangesArgs,
  ReservePublicationArgs,
  RestoreChangesArgs,
  RestoreChangesResultArgs,
} from '../types'
import { agentIdentity } from './chat/identities'
import { insertMessage } from './messageContents'
import { requireEnabled, requireMember } from './session/memberships'
import { agentWithHome } from './skills/homes'
import { ownsExecution, scheduleStream } from './stream/execution'

/** Reserves one capture identity across retries, handoffs and split segments. */
export async function prepareChanges(
  ctx: MutationCtx,
  args: PrepareChangesArgs,
) {
  const stream = await ctx.db.get(args.streamId)
  if (!ownsExecution(stream, args)) return null

  const existing = await forStream(ctx, stream._id)
  if (existing) {
    if (existing.messageId !== stream.state.processingMessageId) {
      const current = await ctx.db.get(stream.state.processingMessageId)
      if (current) {
        await ctx.db.patch(existing._id, {
          messageId: current._id,
          version: current.selectedVersion,
        })
        await ctx.db.patch(current._id, { hasChanges: true })
        return ctx.db.get(existing._id)
      }
    }
    return existing
  }

  const session = await ctx.db.get(stream.sessionId)
  const message = await ctx.db.get(stream.state.processingMessageId)
  if (!session || !message) return null

  const groupId = stream.changeGroupId ?? String(stream._id)

  const id = await ctx.db.insert('changeSets', {
    sessionId: session.parent?.sessionId ?? session._id,
    streamId: stream._id,
    groupId,
    root: !session.parent,
    agentId: stream.agentId,
    messageId: message._id,
    version: message.selectedVersion,
    workspace: args.workspace,
    phase: 'capturing',
    state: 'applied',
    revision: 0,
    fileCount: 0,
    additions: 0,
    deletions: 0,
    issues: [],
    conflicts: [],
  })

  await ctx.db.patch(message._id, { hasChanges: true })

  return ctx.db.get(id)
}

export function forStream(
  ctx: QueryCtx | MutationCtx,
  streamId: Id<'streams'>,
) {
  return ctx.db
    .query('changeSets')
    .withIndex('by_streamId', (q) => q.eq('streamId', streamId))
    .first()
}

export async function queueChanges(
  ctx: MutationCtx,
  args: { streamId: Id<'streams'>; generation: number },
) {
  const stream = await ctx.db.get(args.streamId)
  if (!ownsExecution(stream, args)) return
  const row = await forStream(ctx, stream._id)
  if (row) await ctx.db.patch(row._id, { phase: 'queued' })
  await scheduleStream(ctx, stream._id, { delayMs: 1000 })
}

export async function captureIssue(
  ctx: MutationCtx,
  args: { changeSetId: Id<'changeSets'>; message: string },
) {
  const row = await ctx.db.get(args.changeSetId)
  if (!row) return
  const published = row.phase === 'ready' || row.phase === 'restoring'
  await ctx.db.patch(row._id, {
    phase: published ? row.phase : 'unavailable',
    error: args.message,
  })
}

/** Schedules filesystem finalization before the stream identity is discarded. */
export async function finishChanges(ctx: MutationCtx, streamId: Id<'streams'>) {
  const row = await forStream(ctx, streamId)
  if (!row) {
    const stream = await ctx.db.get(streamId)
    if (!stream?.changeGroupId) return
    const parent = await ctx.db
      .query('changeSets')
      .withIndex('by_groupId', (q) => q.eq('groupId', stream.changeGroupId!))
      .first()
    if (parent)
      await ctx.scheduler.runAfter(
        0,
        internal.actions.workspaces._finishChangesParticipant,
        { changeSetId: parent._id, participantId: String(streamId) },
      )
    return
  }
  if (row.finished) return

  await ctx.db.patch(row._id, { finished: true })
  await ctx.scheduler.runAfter(0, internal.actions.workspaces._finishChanges, {
    changeSetId: row._id,
  })
}

export async function finishContext(
  ctx: QueryCtx,
  args: { changeSetId: Id<'changeSets'> },
) {
  const row = await ctx.db.get(args.changeSetId)
  if (!row) return null

  const children = await ctx.db
    .query('sessions')
    .withIndex('by_parentSessionId', (q) =>
      q.eq('parent.sessionId', row.sessionId),
    )
    .collect()

  const pending: string[] = []
  for (const child of children) {
    if (String(child.parent?.streamId) !== row.groupId) continue
    const streams = await ctx.db
      .query('streams')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', child._id))
      .collect()
    pending.push(...streams.map((stream) => String(stream._id)))
  }

  return { row, pending }
}

/** Reserves publication once, retaining its identity across storage upload retries. */
export async function reservePublication(
  ctx: MutationCtx,
  args: ReservePublicationArgs,
) {
  const row = await ctx.db.get(args.changeSetId)
  if (!row || !(await ctx.db.get(row.sessionId))) return null

  if (!args.late) {
    await ctx.db.patch(row._id, { checkpointId: args.checkpointId })
    return row._id
  }

  const group = await ctx.db
    .query('changeSets')
    .withIndex('by_groupId', (q) => q.eq('groupId', row.groupId))
    .collect()

  const existing = group.find((item) => item.checkpointId === args.checkpointId)
  if (existing && existing._id !== row._id) return existing._id

  const agent = await ctx.db.get(row.agentId)

  const { messageId } = await insertMessage(
    ctx,
    {
      sessionId: row.sessionId,
      role: 'assistant',
      sender: { type: 'agent', id: row.agentId },
      ...(agent ? agentIdentity(agent) : {}),
      status: 'done',
    },
    [
      {
        type: 'text',
        text: 'Background work finished with additional file changes.',
      },
    ],
  )

  await ctx.db.patch(messageId, { hasChanges: true })

  return ctx.db.insert('changeSets', {
    sessionId: row.sessionId,
    agentId: row.agentId,
    streamId: row.streamId,
    groupId: row.groupId,
    root: false,
    messageId,
    version: 1,
    workspace: row.workspace,
    finished: true,
    checkpointId: args.checkpointId,
    phase: 'capturing',
    state: 'applied',
    revision: 0,
    fileCount: 0,
    additions: 0,
    deletions: 0,
    issues: [],
    conflicts: [],
  })
}

export async function appendChanges(ctx: MutationCtx, args: AppendChangesArgs) {
  const row = await ctx.db.get(args.changeSetId)
  if (
    !row ||
    !(await ctx.db.get(row.sessionId)) ||
    row.phase === 'ready' ||
    row.phase === 'restoring'
  ) {
    return discardUploads(ctx, args.files)
  }

  let count = row.fileCount
  for (const file of args.files) {
    const existing = await ctx.db
      .query('changeFiles')
      .withIndex('by_changeSetId_key', (q) =>
        q.eq('changeSetId', row._id).eq('file.key', file.file.key),
      )
      .unique()
    if (existing) {
      await ctx.storage.delete(file.diffStorageId)
      continue
    }
    await ctx.db.insert('changeFiles', {
      sessionId: row.sessionId,
      changeSetId: row._id,
      ...file,
    })
    count++
  }

  await ctx.db.patch(row._id, { fileCount: count })
}

export async function publishChanges(
  ctx: MutationCtx,
  args: PublishChangesArgs,
) {
  const row = await ctx.db.get(args.changeSetId)

  if (!row || row.phase === 'ready' || row.phase === 'restoring') {
    return
  }
  if (row.fileCount !== args.fileCount) {
    error('Checkpoint display upload is incomplete', 409)
  }

  await ctx.db.patch(row._id, {
    phase: args.fileCount || args.issues.length ? 'ready' : 'empty',
    additions: args.additions,
    deletions: args.deletions,
    issues: args.issues,
    error: undefined,
  })
}

async function discardUploads(
  ctx: MutationCtx,
  files: AppendChangesArgs['files'],
) {
  for (const file of files) await ctx.storage.delete(file.diffStorageId)
}

export async function settleCapture(
  ctx: MutationCtx,
  args: { changeSetId: Id<'changeSets'> },
) {
  const row = await ctx.db.get(args.changeSetId)
  if (row && !['ready', 'restoring', 'unavailable'].includes(row.phase))
    await ctx.db.patch(row._id, { phase: 'empty' })
}

export async function changeSummary(
  ctx: AuthQueryCtx,
  args: { messageId: Id<'messages'>; version: number },
) {
  const message = await ctx.db.get(args.messageId)
  if (!message) return null

  await requireMember(ctx, message.sessionId, ctx.userId)

  const row = await ctx.db
    .query('changeSets')
    .withIndex('by_messageId_version', (q) =>
      q.eq('messageId', args.messageId).eq('version', args.version),
    )
    .first()
  if (!row || row.phase === 'empty') return null

  const group = await ctx.db
    .query('changeSets')
    .withIndex('by_groupId', (q) => q.eq('groupId', row.groupId))
    .collect()

  const writing = group.some((item) => !item.writersSettled)

  return {
    ...row,
    canRestore: ctx.role === 'admin' && !row.issues.length && !writing,
  }
}

export async function changeDiff(
  ctx: AuthQueryCtx,
  args: { changeSetId: Id<'changeSets'>; fileKey: string },
) {
  const row = await ctx.db.get(args.changeSetId)
  if (!row) return null

  await requireMember(ctx, row.sessionId, ctx.userId)

  const file = await ctx.db
    .query('changeFiles')
    .withIndex('by_changeSetId_key', (q) =>
      q.eq('changeSetId', row._id).eq('file.key', args.fileKey),
    )
    .unique()

  return file ? ctx.storage.getUrl(file.diffStorageId) : null
}

export async function restoreChanges(
  ctx: AuthMutationCtx,
  args: RestoreChangesArgs,
) {
  requireRole(ctx.role, 'admin')

  const row = await ctx.db.get(args.changeSetId)
  if (!row) error('Changes not found', 404)

  const { session } = await requireMember(ctx, row.sessionId, ctx.userId)
  requireEnabled(session)

  if (row.phase === 'restoring') {
    return
  }
  if (row.phase !== 'ready' || row.issues.length) {
    error('Checkpoint is unavailable or incomplete', 409)
  }
  if (row.revision !== args.revision) {
    error('Changes state changed; refresh and try again', 409)
  }
  if (!row.writersSettled) {
    error('Wait for workspace writers to finish', 409)
  }

  const operationId = `${row._id}:${row.revision}:${args.direction}`

  await ctx.db.patch(row._id, {
    phase: 'restoring',
    operationId,
    requestedBy: ctx.userId,
    direction: args.direction,
    conflicts: [],
    error: undefined,
  })

  await ctx.scheduler.runAfter(0, internal.actions.workspaces._restoreChanges, {
    changeSetId: row._id,
    operationId,
  })
}

export async function restoreResult(
  ctx: MutationCtx,
  args: RestoreChangesResultArgs,
) {
  const row = await ctx.db.get(args.changeSetId)
  if (!row || row.operationId !== args.operationId) return
  await ctx.db.patch(row._id, {
    phase: 'ready',
    state: args.state ?? row.state,
    revision: args.revision ?? row.revision,
    conflicts: args.conflicts ?? [],
    error: args.error,
  })
}

export async function getChangeSet(
  ctx: QueryCtx,
  args: { changeSetId: Id<'changeSets'> },
) {
  return ctx.db.get(args.changeSetId)
}

/** Batches cleanup so large turns stay within Convex transaction limits. */
export async function removeChanges(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
) {
  await ctx.scheduler.runAfter(0, internal.chat._cleanupChanges, { sessionId })
}

export async function cleanupChanges(
  ctx: MutationCtx,
  args: { sessionId: Id<'sessions'> },
) {
  const files = await ctx.db
    .query('changeFiles')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))
    .take(100)

  for (const file of files) {
    await ctx.storage.delete(file.diffStorageId)
    await ctx.db.delete(file._id)
  }

  if (files.length === 100) return removeChanges(ctx, args.sessionId)

  const rows = await ctx.db
    .query('changeSets')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))
    .take(100)
  for (const row of rows) await ctx.db.delete(row._id)

  if (rows.length === 100) return removeChanges(ctx, args.sessionId)

  await ctx.scheduler.runAfter(
    0,
    internal.actions.workspaces._removeChanges,
    args,
  )
}

export async function scheduleSettleChanges(
  ctx: MutationCtx,
  args: { changeSetId: Id<'changeSets'> },
) {
  const row = await ctx.db.get(args.changeSetId)
  if (!row || row.settleScheduled) return
  await ctx.db.patch(row._id, { settleScheduled: true })
  await ctx.scheduler.runAfter(
    2000,
    internal.actions.workspaces._settleChanges,
    { ...args, sequence: 0 },
  )
}

export async function restoreContext(
  ctx: QueryCtx,
  args: { changeSetId: Id<'changeSets'> },
) {
  const row = await ctx.db.get(args.changeSetId)
  if (!row) return null
  if (!row.requestedBy) error('Restore requester is missing', 409)

  const requester = await ctx.db.get(row.requestedBy)
  requireRole(requester?.role, 'admin')
  const { session } = await requireMember(ctx, row.sessionId, row.requestedBy)
  requireEnabled(session)

  const group = await ctx.db
    .query('changeSets')
    .withIndex('by_groupId', (q) => q.eq('groupId', row.groupId))
    .collect()

  const agents = await Promise.all(
    [...new Set(group.map((item) => item.agentId))].map((id) =>
      agentWithHome(ctx, id),
    ),
  )

  return {
    workspace: session.workspace,
    agents: agents.filter((agent) => agent !== null),
  }
}

export async function changeFiles(
  ctx: AuthQueryCtx,
  args: { changeSetId: Id<'changeSets'>; paginationOpts: PaginationOptions },
) {
  const row = await ctx.db.get(args.changeSetId)
  if (!row) return { page: [], isDone: true, continueCursor: '' }

  await requireMember(ctx, row.sessionId, ctx.userId)

  const result = await ctx.db
    .query('changeFiles')
    .withIndex('by_changeSetId', (q) => q.eq('changeSetId', row._id))
    .paginate(args.paginationOpts)

  return { ...result, page: result.page.map((item) => item.file) }
}

export async function releaseChangeGroup(
  ctx: MutationCtx,
  args: { groupId: string },
) {
  const group = await ctx.db
    .query('changeSets')
    .withIndex('by_groupId', (q) => q.eq('groupId', args.groupId))
    .collect()
  for (const row of group) await ctx.db.patch(row._id, { writersSettled: true })
}

import type { ShellToolOutput } from '@sb/core/types/tools'

import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { sharedSessionId } from '../lib/subagent'
import { getSessionWithWorkspace } from './session/folderContext'
import { deliverShellReport } from './shellReports'

/**
 * How long one watcher action follows a job before handing it to a new one to
 * outlive the Convex action time limit.
 */
export const SHELL_WATCH_WINDOW_MS = 8 * 60 * 1000

/** A watcher that misses two windows is assumed dead and is restarted. */
const WATCH_STALE_MS = 2 * SHELL_WATCH_WINDOW_MS

type RegisterArgs = {
  sessionId: Id<'sessions'>
  agentId: Id<'agents'>
  invokedBy: Id<'users'>
  jobId: string
  command: string
  toolCallId: string
}

/** Starts watching a background job if not already watched. */
export async function register(ctx: MutationCtx, args: RegisterArgs) {
  const existing = await getByJobId(ctx, args.sessionId, args.jobId)
  if (existing) return

  const now = Date.now()
  const shellJobId = await ctx.db.insert('shellJobs', {
    ...args,
    generation: 0,
    startedAt: now,
    heartbeatAt: now,
    term: '',
    termOffset: 0,
  })

  await scheduleWatcher(ctx, shellJobId)
}

/** Drops a watch, cancelling its watcher. The job itself is left running. */
export async function release(
  ctx: MutationCtx,
  { sessionId, jobId }: { sessionId: Id<'sessions'>; jobId: string },
) {
  const row = await getByJobId(ctx, sessionId, jobId)
  if (row) await removeWatch(ctx, row)
}

/** Marks a job as stopped by a user, so its report doesn't wake the agent. */
export async function markUserKilled(
  ctx: MutationCtx,
  { sessionId, jobId }: { sessionId: Id<'sessions'>; jobId: string },
) {
  const row =
    (await getByJobId(ctx, sessionId, jobId)) ??
    (await getByJobIdForChildren(ctx, sessionId, jobId))
  if (row) await ctx.db.patch(row._id, { userKilled: true })
}

/** Marks every watched job of a session and its children as stopped by a user. */
export async function markAllUserKilled(
  ctx: MutationCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  for (const id of await withChildSessionIds(ctx, sessionId)) {
    const rows = await ctx.db
      .query('shellJobs')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', id))
      .collect()
    for (const row of rows) await ctx.db.patch(row._id, { userKilled: true })
  }
}

/** Drops every watch of a session being torn down. */
export async function releaseForSession(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
) {
  const rows = await ctx.db
    .query('shellJobs')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()

  for (const row of rows) await removeWatch(ctx, row)
}

/**
 * Claims the job for one watcher window. Refreshes the heartbeat and returns
 * what the watcher needs to pick the job's output up where the last window
 * left it. Null once the watch is gone.
 */
export async function _beginWindow(
  ctx: MutationCtx,
  {
    shellJobId,
    generation,
  }: { shellJobId: Id<'shellJobs'>; generation: number },
) {
  const row = await ctx.db.get(shellJobId)
  if (!matchesWatcher(row, generation)) return null
  if (!row.watcherId) return null

  const session = await getSessionWithWorkspace(ctx, row.sessionId)
  if (!session?.workspace) return null

  await ctx.db.patch(shellJobId, {
    heartbeatAt: Date.now(),
    watcherId: undefined,
  })

  return {
    sessionId: sharedSessionId(session),
    owner: row.sessionId,
    workspaceId: session.workspace.workspaceId,
    workspace: session.workspace,
    toolCallId: row.toolCallId,
    resume: { jobId: row.jobId, term: row.term, termOffset: row.termOffset },
  }
}

type CarryArgs = {
  generation: number
  shellJobId: Id<'shellJobs'>
  term: string
  termOffset: number
}

/** Hands a running job to a new window. */
export async function _carry(
  ctx: MutationCtx,
  { shellJobId, generation, term, termOffset }: CarryArgs,
) {
  const row = await ctx.db.get(shellJobId)
  if (!ownsWatcher(row, generation)) return

  await ctx.db.patch(shellJobId, { term, termOffset })
  await scheduleWatcher(ctx, shellJobId)
}

type ReportArgs = {
  generation: number
  shellJobId: Id<'shellJobs'>
  output?: ShellToolOutput
  errorText?: string
}

/** Settles a watch and hands the job's result to its agent. */
export async function _report(
  ctx: MutationCtx,
  { shellJobId, generation, output, errorText }: ReportArgs,
) {
  const row = await ctx.db.get(shellJobId)
  if (!ownsWatcher(row, generation)) return

  await removeWatch(ctx, row)
  await deliverShellReport(ctx, row, { output, errorText })
}

/** Restarts watchers that stopped reporting in. */
export async function refresh(ctx: MutationCtx) {
  const stale = await ctx.db
    .query('shellJobs')
    .withIndex('by_heartbeatAt', (q) =>
      q.lt('heartbeatAt', Date.now() - WATCH_STALE_MS),
    )
    .collect()

  for (const row of stale) {
    await ctx.db.patch(row._id, { heartbeatAt: Date.now() })
    await scheduleWatcher(ctx, row._id)
  }
}

function getByJobId(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  jobId: string,
) {
  return ctx.db
    .query('shellJobs')
    .withIndex('by_sessionId_jobId', (q) =>
      q.eq('sessionId', sessionId).eq('jobId', jobId),
    )
    .unique()
}

async function getByJobIdForChildren(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  jobId: string,
) {
  for (const child of await childSessions(ctx, sessionId)) {
    const row = await getByJobId(ctx, child._id, jobId)
    if (row) return row
  }
  return undefined
}

async function withChildSessionIds(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
) {
  const children = await childSessions(ctx, sessionId)
  return [sessionId, ...children.map((child) => child._id)]
}

function childSessions(ctx: MutationCtx, sessionId: Id<'sessions'>) {
  return ctx.db
    .query('sessions')
    .withIndex('by_parentSessionId', (q) => q.eq('parent.sessionId', sessionId))
    .collect()
}

function matchesWatcher(
  row: Doc<'shellJobs'> | null,
  generation: number,
): row is Doc<'shellJobs'> {
  return row?.generation === generation
}

function ownsWatcher(
  row: Doc<'shellJobs'> | null,
  generation: number,
): row is Doc<'shellJobs'> {
  if (!matchesWatcher(row, generation)) return false
  return !row.watcherId
}

async function scheduleWatcher(ctx: MutationCtx, shellJobId: Id<'shellJobs'>) {
  const row = await ctx.db.get(shellJobId)
  if (!row) return
  if (row.watcherId) await ctx.scheduler.cancel(row.watcherId)
  const generation = row.generation + 1
  const watcherId = await ctx.scheduler.runAfter(
    0,
    internal.actions.shellJobs._watch,
    { shellJobId, generation },
  )
  await ctx.db.patch(shellJobId, { watcherId, generation })
}

async function removeWatch(ctx: MutationCtx, row: Doc<'shellJobs'>) {
  if (row.watcherId) await ctx.scheduler.cancel(row.watcherId)
  await ctx.db.delete(row._id)
}

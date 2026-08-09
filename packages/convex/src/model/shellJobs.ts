import type { ShellToolOutput } from '@sb/core/types/tools'

import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import {
  SHELL_REPORT_PART_TYPE,
  type ShellReportPart,
  type ShellReportStatus,
} from '../lib/shellReport'
import { sharedSessionId } from '../lib/subagent'
import { agentIdentity } from './chat/identities'
import { insertMessage } from './messageContents'
import { getActiveStream } from './session/memberships'
import { getByOwnerId as getSettingsByOwnerId } from './settings'
import { reserveInvokeTurn } from './stream/lifecycle'

/** Reports stay well under the segment split budget. */
const REPORT_MAX_CHARS = 32 * 1024

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
  { shellJobId }: { shellJobId: Id<'shellJobs'> },
) {
  const row = await ctx.db.get(shellJobId)
  if (!row) return null

  const session = await ctx.db.get(row.sessionId)
  if (!session?.workspace) return null

  await ctx.db.patch(shellJobId, {
    heartbeatAt: Date.now(),
    watcherId: undefined,
  })

  return {
    sessionId: sharedSessionId(session),
    owner: row.sessionId,
    workspaceId: session.workspace.workspaceId,
    toolCallId: row.toolCallId,
    resume: { jobId: row.jobId, term: row.term, termOffset: row.termOffset },
  }
}

type CarryArgs = {
  shellJobId: Id<'shellJobs'>
  term: string
  termOffset: number
}

/** Hands a running job to a new window. */
export async function _carry(
  ctx: MutationCtx,
  { shellJobId, term, termOffset }: CarryArgs,
) {
  const row = await ctx.db.get(shellJobId)
  if (!row) return

  await ctx.db.patch(shellJobId, { term, termOffset })
  await scheduleWatcher(ctx, shellJobId)
}

type ReportArgs = {
  shellJobId: Id<'shellJobs'>
  output?: ShellToolOutput
  errorText?: string
}

/** Settles a watch and hands the job's result to its agent. */
export async function _report(
  ctx: MutationCtx,
  { shellJobId, output, errorText }: ReportArgs,
) {
  const row = await ctx.db.get(shellJobId)
  if (!row) return

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

/**
 * Delivers a finished job's output to the session that started it as its own
 * `shell-report` message, then wakes the agent if idle.
 */
async function deliverShellReport(
  ctx: MutationCtx,
  row: Doc<'shellJobs'>,
  { output, errorText }: { output?: ShellToolOutput; errorText?: string },
) {
  const session = await ctx.db.get(row.sessionId)
  if (!session) return

  const agent = await ctx.db.get(row.agentId)
  const settings = agent ? await getSettingsByOwnerId(ctx, agent.ownerId) : null

  const part: ShellReportPart = {
    type: SHELL_REPORT_PART_TYPE,
    jobId: row.jobId,
    command: row.command,
    ...resolveReport(output, errorText),
  }

  // Activity is synced when the woken turn completes
  const { messageId } = await insertMessage(
    ctx,
    {
      sessionId: row.sessionId,
      sender: { type: 'agent', id: row.agentId },
      role: 'user', // no 'system' because some providers complain
      ...(agent ? await agentIdentity(ctx, agent, settings) : {}),
      status: 'done',
    },
    [part],
  )

  // A live turn consumes the report at its end via the follow-up gate
  if (await getActiveStream(ctx, row.sessionId)) return

  const message = await ctx.db.get(messageId)
  if (!message) return

  await reserveInvokeTurn(ctx, {
    session,
    boundaryMessage: message,
    invokedBy: row.invokedBy,
  })
}

function resolveReport(
  output: ShellToolOutput | undefined,
  errorText: string | undefined,
): { status: ShellReportStatus; text: string; exitCode?: number } {
  if (errorText || !output) {
    return {
      status: 'failed',
      text: errorText ?? 'The job produced no result.',
    }
  }

  return {
    status: reportStatus(output),
    text: truncateReport(output.text) || '(no output)',
    ...(output.exitCode != null && { exitCode: output.exitCode }),
  }
}

function reportStatus(output: ShellToolOutput): ShellReportStatus {
  return output.status === 'running' || output.status === 'background'
    ? 'failed'
    : output.status
}

function truncateReport(text: string): string {
  if (text.length <= REPORT_MAX_CHARS) return text
  return `${text.slice(0, REPORT_MAX_CHARS)}\n\n[Output truncated.]`
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

async function scheduleWatcher(ctx: MutationCtx, shellJobId: Id<'shellJobs'>) {
  const watcherId = await ctx.scheduler.runAfter(
    0,
    internal.actions.shellJobs._watch,
    { shellJobId },
  )
  await ctx.db.patch(shellJobId, { watcherId })
}

async function removeWatch(ctx: MutationCtx, row: Doc<'shellJobs'>) {
  if (row.watcherId) await ctx.scheduler.cancel(row.watcherId)
  await ctx.db.delete(row._id)
}

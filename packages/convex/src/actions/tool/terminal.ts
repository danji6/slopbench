'use node'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { authorizeAdmin } from '../../functions'
import type {
  ShellJobPoll,
  ShellJobSummary,
  TerminalKillArgs,
  TerminalPollArgs,
  TerminalResizeArgs,
  TerminalSessionArgs,
  TerminalWriteArgs,
} from '../../types'

export async function write(ctx: ActionCtx, args: TerminalWriteArgs) {
  await requireSessionAccess(ctx, args.sessionId)
  const { postSidecar } = await import('../../model/sidecar')
  await postSidecar('/shell/stdin', args)
}

export async function kill(ctx: ActionCtx, args: TerminalKillArgs) {
  await requireSessionAccess(ctx, args.sessionId)
  const { postSidecar } = await import('../../model/sidecar')
  await postSidecar('/shell/kill', args)
}

export async function resize(ctx: ActionCtx, args: TerminalResizeArgs) {
  await requireSessionAccess(ctx, args.sessionId)
  const { postSidecar } = await import('../../model/sidecar')
  await postSidecar('/shell/resize', args)
}

export async function background(ctx: ActionCtx, args: TerminalKillArgs) {
  await requireSessionAccess(ctx, args.sessionId)
  const { postSidecar } = await import('../../model/sidecar')
  await postSidecar('/shell/background', args)
}

export async function list(
  ctx: ActionCtx,
  args: TerminalSessionArgs,
): Promise<{ jobs: ShellJobSummary[] }> {
  await requireSessionAccess(ctx, args.sessionId)
  const { postSidecar } = await import('../../model/sidecar')
  return postSidecar('/shell/list', { sessionId: args.sessionId })
}

export async function poll(
  ctx: ActionCtx,
  args: TerminalPollArgs,
): Promise<ShellJobPoll> {
  await requireSessionAccess(ctx, args.sessionId)
  const { postSidecar } = await import('../../model/sidecar')
  return postSidecar('/shell/poll', args)
}

export async function killAll(
  ctx: ActionCtx,
  args: TerminalSessionArgs,
): Promise<void> {
  await requireSessionAccess(ctx, args.sessionId)
  const { postSidecar } = await import('../../model/sidecar')
  await postSidecar('/shell/kill_session', {
    sessionId: args.sessionId,
    includeBackground: true,
  })
}

export async function _killSessionJobs(
  _ctx: ActionCtx,
  args: { sessionId: Id<'sessions'> },
) {
  const { postSidecar } = await import('../../model/sidecar')
  try {
    await postSidecar('/shell/kill_session', { sessionId: args.sessionId })
  } catch {
    // Sidecar could be down, no-op
  }
}

async function requireSessionAccess(ctx: ActionCtx, sessionId: Id<'sessions'>) {
  const identity = await authorizeAdmin(ctx)
  await ctx.runQuery(internal.sessions._getMemberWorkspaceContext, {
    sessionId,
    subject: identity.subject,
  })
}

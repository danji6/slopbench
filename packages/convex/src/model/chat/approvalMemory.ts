import { internal } from '../../_generated/api'
import type { AuthMutationCtx } from '../../functions'
import {
  analyzeShellCommand,
  toolNamesForApproval,
} from '../../lib/tool/approval'
import type { RememberScope, Session } from '../../types'
import { _allowToolPaths as allowToolPaths } from '../session/sessions'
import { appendApprovals, getApprovals } from '../session/state'

/** The tool call an approval answered. */
export type ApprovedTool = {
  toolName: string
  input: unknown
  /** Sensitive paths resolved when the approval was requested. */
  paths?: string[]
}

export async function rememberApproval(
  ctx: AuthMutationCtx,
  session: Session,
  matched: ApprovedTool,
  scope: RememberScope,
) {
  const approvals = await getApprovals(ctx, session._id)

  if (scope === 'paths') {
    await rememberPaths(ctx, session, matched)
    return
  }

  if (matched.toolName === 'shell') {
    const command = (matched.input as { command?: string } | undefined)?.command
    const additions = command
      ? analyzeShellCommand(command, approvals.shell ?? []).unapproved
      : []
    if (additions.length === 0) return

    await appendApprovals(ctx, session._id, 'shell', additions)
    return
  }

  const tools = approvals.tools ?? []
  const additions = toolNamesForApproval(matched.toolName).filter(
    (toolName) => !tools.includes(toolName),
  )
  if (additions.length === 0) return

  await appendApprovals(ctx, session._id, 'tools', additions)
}

/** Saves resolved paths or schedules discovery against the current workspace. */
async function rememberPaths(
  ctx: AuthMutationCtx,
  session: Session,
  matched: ApprovedTool,
) {
  const command = (matched.input as { command?: string } | undefined)?.command
  if (matched.toolName !== 'shell') return
  if (!command || !session.workspace) return

  if (matched.paths?.length) {
    await allowToolPaths(ctx, {
      sessionId: session._id,
      paths: matched.paths,
    })
    return
  }

  await ctx.scheduler.runAfter(
    0,
    internal.actions.workspaces._rememberFlaggedPaths,
    {
      sessionId: session._id,
      workspaceId: session.workspace.workspaceId,
      workspace: session.workspace,
      command,
    },
  )
}

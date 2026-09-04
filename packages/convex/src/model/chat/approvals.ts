import { internal } from '../../_generated/api'
import type { Doc } from '../../_generated/dataModel'
import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import { requireRole } from '../../functions'
import {
  analyzeShellCommand,
  toolNamesForApproval,
} from '../../lib/tool/approval'
import type { ApproveToolArgs, RememberScope } from '../../types'
import { getProcessingSegmentRow, patchSegmentParts } from '../messageContents'
import { applyModeTransition } from '../plans'
import * as Memberships from '../session/memberships'
import { _allowToolPaths as allowToolPaths } from '../session/sessions'
import { appendApprovals, getApprovals } from '../session/state'
import { APPROVAL_LEASE_MS } from '../stream/lifecycle'
import { resumeIfSettled } from '../stream/subagents'

/** The tool call an approval answered. */
type ApprovedTool = {
  toolName: string
  input: unknown
  /** Sensitive paths resolved when the approval was requested. */
  paths?: string[]
}

export async function approveTool(ctx: AuthMutationCtx, args: ApproveToolArgs) {
  requireRole(ctx.role, 'admin')

  const { session } = await Memberships.requireMember(
    ctx,
    args.sessionId,
    ctx.userId,
  )

  const stream = await Memberships.getActiveStream(ctx, args.sessionId)
  if (
    !stream ||
    stream.status !== 'awaiting_approval' ||
    !stream.processingMessageId
  ) {
    error('No tool approval is pending', 409)
  }

  const message = await ctx.db.get(stream.processingMessageId)
  if (!message) error('Message not found', 404)

  const row = await getProcessingSegmentRow(ctx, stream)
  if (!row) error('Message not found', 404)

  const { parts, matched, hasPendingApprovals } = patchToolApproval(
    row.parts,
    args,
  )

  await patchSegmentParts(ctx, message._id, row, parts)

  if (args.approved && matched) {
    await applyPlanModeTransition(ctx, stream, matched.toolName)
  }

  if (args.approved && args.remember && matched) {
    await rememberApproval(ctx, session, matched, args.remember)
  }

  if (hasPendingApprovals) {
    await ctx.db.patch(stream._id, {
      attempt: 0,
      leaseExpiresAt: Date.now() + APPROVAL_LEASE_MS,
    })
    return
  }

  // Resumes now, or keeps waiting for sub-agents spawned in the same step
  await resumeIfSettled(ctx, stream, parts)
}

/**
 * Locks the plan and returns the session to normal mode if approving
 * exit_plan_mode. Does the inverse if approving enter_plan_mode.
 */
export async function applyPlanModeTransition(
  ctx: AuthMutationCtx,
  stream: Doc<'streams'>,
  toolName: string,
) {
  if (toolName !== 'enter_plan_mode' && toolName !== 'exit_plan_mode') return
  await applyModeTransition(ctx, stream.sessionId, toolName, stream._id)
}

export function patchToolApproval(
  parts: unknown[],
  args: {
    toolCallId: string
    approved: boolean
    reason?: string
    note?: string
  },
) {
  let matched: ApprovedTool | undefined
  const next = parts.map((part) => {
    if (
      typeof part !== 'object' ||
      part === null ||
      !('toolCallId' in part) ||
      part.toolCallId !== args.toolCallId
    ) {
      return part
    }

    const typed = part as {
      type?: string
      input?: unknown
      state?: string
      approvalPaths?: string[]
      approval?: {
        id?: string
        reason?: string
        approved?: boolean
        note?: string
      }
    }

    if (typed.state !== 'approval-requested' || !typed.approval?.id) {
      return part
    }

    matched = {
      toolName: typed.type?.replace(/^tool-/, '') ?? '',
      input: typed.input,
      paths: typed.approvalPaths,
    }
    const note = args.note?.trim()
    return {
      ...typed,
      state: args.approved ? 'approval-responded' : 'output-denied',
      approval: {
        id: typed.approval.id,
        approved: args.approved,
        ...(args.reason && { reason: args.reason }),
        ...(note && { note }),
      },
    }
  })

  if (!matched) error('Tool approval not found', 404)
  return {
    parts: next,
    matched,
    hasPendingApprovals: hasPendingToolApprovals(next),
  }
}

async function rememberApproval(
  ctx: AuthMutationCtx,
  session: Doc<'sessions'>,
  matched: ApprovedTool,
  scope: RememberScope,
) {
  const approvals = await getApprovals(ctx, session._id)

  if (scope === 'paths') {
    const command = (matched.input as { command?: string } | undefined)?.command
    if (matched.toolName !== 'shell' || !command || !session.workspace) return

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
        command,
      },
    )

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

export function hasPendingToolApprovals(parts: unknown[]) {
  return parts.some((part) => {
    if (typeof part !== 'object' || part === null) return false
    if (!('type' in part) || typeof part.type !== 'string') return false
    if (!part.type.startsWith('tool-')) return false
    return 'state' in part && part.state === 'approval-requested'
  })
}

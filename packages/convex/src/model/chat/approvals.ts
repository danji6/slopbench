import { hasPendingToolApprovals } from '@sb/core/utils/tool-parts'

import type { Doc } from '../../_generated/dataModel'
import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import { requireRole } from '../../functions'
import type { ApproveToolArgs } from '../../types'
import { getProcessingSegmentRow, patchSegmentParts } from '../messageContents'
import { applyModeTransition } from '../plans'
import { getSessionWithWorkspace } from '../session/folderContext'
import * as Memberships from '../session/memberships'
import { APPROVAL_LEASE_MS } from '../stream/lifecycle'
import { resumeIfSettled } from '../stream/subagents'
import { type ApprovedTool, rememberApproval } from './approvalMemory'

type ApprovalResponse = Pick<
  ApproveToolArgs,
  'toolCallId' | 'approved' | 'reason' | 'note'
>

type ApprovalPart = {
  type?: string
  input?: unknown
  state?: string
  approvalPaths?: string[]
  approval?: { id?: string; reason?: string; approved?: boolean; note?: string }
}

export async function approveTool(ctx: AuthMutationCtx, args: ApproveToolArgs) {
  requireRole(ctx.role, 'admin')

  const session = await resolveApprovalSession(ctx, args)

  const stream = await Memberships.getActiveStream(ctx, session._id)
  if (!stream) error('No tool approval is pending', 409)
  if (stream.state.phase !== 'awaiting_approval') {
    error('No tool approval is pending', 409)
  }

  const message = await ctx.db.get(stream.state.processingMessageId)
  if (!message) error('Message not found', 404)

  const row = await getProcessingSegmentRow(ctx, stream)
  if (!row) error('Message not found', 404)

  const { parts, matched, hasPendingApprovals } = patchToolApproval(
    row.parts,
    args,
  )

  await patchSegmentParts(ctx, message._id, row, parts)

  if (args.approved) {
    await applyPlanModeTransition(ctx, stream, matched.toolName)
  }

  if (args.approved && args.remember) {
    await rememberApproval(ctx, session, matched, args.remember)
  }

  if (hasPendingApprovals) {
    await ctx.db.patch(stream._id, {
      attempt: 0,
      leaseExpiresAt: Date.now() + APPROVAL_LEASE_MS,
    })
    return
  }

  // Resume the session that owns the approved call
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

export function patchToolApproval(parts: unknown[], args: ApprovalResponse) {
  let matched: ApprovedTool | undefined
  const next = parts.map((part) => {
    if (typeof part !== 'object' || part === null) return part
    if (!('toolCallId' in part) || part.toolCallId !== args.toolCallId) {
      return part
    }

    const typed = part as ApprovalPart

    if (typed.state !== 'approval-requested') return part
    if (!typed.approval?.id) return part

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

async function resolveApprovalSession(
  ctx: AuthMutationCtx,
  args: ApproveToolArgs,
) {
  const { session: parentSession } = await Memberships.requireMember(
    ctx,
    args.sessionId,
    ctx.userId,
  )

  const session = args.childSessionId
    ? await getSessionWithWorkspace(ctx, args.childSessionId)
    : parentSession
  if (!session) error('Not found', 404)
  const unrelatedChild =
    args.childSessionId && session.parent?.sessionId !== args.sessionId
  if (unrelatedChild) {
    error('Not found', 404)
  }

  return session
}

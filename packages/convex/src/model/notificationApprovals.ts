import {
  PLAN_APPROVALS,
  approvalRememberOption,
} from '@sb/core/approval-presentation'
import type { NotificationApprovalOption } from '@sb/core/notification-actions'
import { isPendingToolApproval } from '@sb/core/utils/tool-parts'
import type { PathApprovalStatus } from '@sb/core/workspace/path-policy'

import type { Doc } from '../_generated/dataModel'
import { error } from '../errors'
import {
  type AuthMutationCtx,
  type AuthQueryCtx,
  requireRole,
} from '../functions'
import { minRole } from '../lib/roles'
import { alwaysLabel, approvalHold } from '../lib/tool/approvalPolicy'
import type { NotificationApprovalAction } from '../types'
import { approveTool } from './chat/approvals'
import { getProcessingSegmentRow } from './messageContents'
import { settleRequest } from './notificationRequests'
import { getSessionWithWorkspace } from './session/folderContext'
import { getMembership } from './session/memberships'
import { getApprovals } from './session/state'
import { requestImmediateStop } from './stream/stop'

type ApprovalPart = {
  type: `tool-${string}`
  state: 'approval-requested'
  input?: unknown
  toolCallId: string
  approval: { id: string }
  approvalPathStatus?: PathApprovalStatus
}

/** Resolves the exact invocation, never a later request in the same session. */
async function pendingRequest(
  ctx: AuthQueryCtx | AuthMutationCtx,
  notification: Doc<'notifications'>,
) {
  const target = notification.approval
  if (!target || notification.kind !== 'approval_required') return null

  const stream = await ctx.db.get(target.streamId)
  if (!stream || stream.leaseExpiresAt < Date.now()) return null
  if (stream.state.phase !== 'awaiting_approval') return null
  if (stream.state.processingMessageId !== target.messageId) return null

  const row = await getProcessingSegmentRow(ctx, stream)
  if (!row || row._id !== target.contentId) return null

  const part = row.parts.find((part) => {
    if (!isPendingToolApproval(part)) return false
    const candidate = part as ApprovalPart
    return (
      candidate.toolCallId === target.toolCallId &&
      candidate.approval?.id === target.approvalId
    )
  }) as ApprovalPart | undefined

  if (!part) return null

  const session = await getSessionWithWorkspace(ctx, stream.sessionId)
  if (!session) return null

  const rootId = session.parent?.sessionId ?? session._id
  if (rootId !== notification.sessionId) return null
  if (!(await getMembership(ctx, rootId, ctx.userId))) return null

  return { stream, session, part }
}

type PendingRequest = NonNullable<Awaited<ReturnType<typeof pendingRequest>>>

/** Uses the same holds and remember scopes as the approval picker. */
async function requestOptions(
  ctx: AuthQueryCtx | AuthMutationCtx,
  { session, part }: PendingRequest,
) {
  const toolName = part.type.slice(5)
  const plan = PLAN_APPROVALS[toolName]
  const options: NotificationApprovalOption[] = [
    { action: 'allow', label: plan?.approveLabel ?? 'Allow' },
  ]
  let remember: 'paths' | 'patterns' | undefined

  if (!plan) {
    const hold = approvalHold(
      toolName,
      part.input,
      session.mode,
      part.approvalPathStatus,
    )
    const label = alwaysLabel(
      toolName,
      part.input,
      await getApprovals(ctx, session._id),
    )
    const remembered = approvalRememberOption(hold, label)
    remember = remembered?.remember
    if (remembered) {
      options.push({
        action: 'allow-session',
        label: 'Allow for this session',
        description: remembered.label,
      })
    }
  }
  options.push({ action: 'deny', label: plan?.denyLabel ?? 'Deny' })

  return { options, remember, plan }
}

/** Enriches inbox entries reactively so settled requests lose their buttons. */
export async function withApprovalActions(
  ctx: AuthQueryCtx,
  notification: Doc<'notifications'>,
) {
  const request = await pendingRequest(ctx, notification)
  const approvalActions =
    request && minRole(ctx.role, 'admin')
      ? (await requestOptions(ctx, request)).options
      : []
  return { ...notification, approvalPending: Boolean(request), approvalActions }
}

/** Applies one authorized response, safely ignoring duplicate or stale clicks. */
export async function respondApproval(
  ctx: AuthMutationCtx,
  notification: Doc<'notifications'>,
  action: NotificationApprovalAction,
) {
  requireRole(ctx.role, 'admin')
  const request = await pendingRequest(ctx, notification)
  if (!request) return 'stale' as const

  const { options, remember, plan } = await requestOptions(ctx, request)
  if (!options.some((option) => option.action === action)) {
    error('This approval option is no longer available', 409)
  }

  if (action === 'deny' && plan?.denyAborts) {
    await settleRequest(ctx, {
      streamId: request.stream._id,
      messageId: request.stream.state.processingMessageId!,
      contentId: notification.approval!.contentId,
      toolCallId: request.part.toolCallId,
    })
    await requestImmediateStop(ctx, request.stream)
  } else {
    await approveTool(ctx, {
      sessionId: notification.sessionId,
      ...(request.session.parent
        ? { childSessionId: request.session._id }
        : {}),
      toolCallId: request.part.toolCallId,
      approved: action !== 'deny',
      ...(action === 'allow-session' ? { remember } : {}),
      ...(action === 'deny' ? { reason: 'Denied by user.' } : {}),
    })
  }

  return 'applied' as const
}

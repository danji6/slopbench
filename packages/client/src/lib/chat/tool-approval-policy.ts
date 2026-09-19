import type { RememberScope, ToolApprovals } from '@/lib/chat'
import { formatAlwaysAllowLabel } from '@/lib/chat/approval-label'
import {
  analyzeShellCommand,
  isPathForbidden,
  isReadOnlyShellCommand,
  toolNamesForApproval,
} from '@sb/convex/lib/tool/approval'
import type { PathApprovalStatus } from '@sb/core/workspace/path-policy'

export type ApprovalAction = {
  id: string
  label: string
  shortcut: string
  remember?: RememberScope
  approved: boolean
  abort?: boolean
}

export type PlanApprovalMeta = {
  heading: string
  approveLabel: string
  denyLabel: string
  /** When true, the deny action aborts the turn instead of denying the tool. */
  denyAborts?: boolean
}

export const PLAN_APPROVALS: Record<string, PlanApprovalMeta> = {
  exit_plan_mode: {
    heading: 'The agent wants to start implementing the plan.',
    approveLabel: 'Approve plan',
    denyLabel: 'Keep planning',
    denyAborts: true,
  },
  enter_plan_mode: {
    heading: 'The agent wants to plan before making changes.',
    approveLabel: 'Enter plan mode',
    denyLabel: 'Decline',
  },
}

export function buildApprovalActions(
  enabled: boolean,
  rememberLabel: string | null,
  hold: ApprovalHold,
  planApproval?: PlanApprovalMeta,
): ApprovalAction[] {
  if (!enabled) return []

  let key = 1
  const getKey = () => String(key++)

  const items: ApprovalAction[] = [
    {
      id: 'approve',
      label: planApproval?.approveLabel ?? 'Allow',
      shortcut: getKey(),
      approved: true,
    },
  ]

  if (planApproval) {
    items.push({
      id: 'deny',
      label: planApproval.denyLabel,
      shortcut: getKey(),
      approved: false,
      abort: planApproval.denyAborts,
    })
    return items
  }

  if (hold === 'paths') {
    items.push({
      id: 'remember-paths',
      label: 'Allow access and edits to these paths for this session',
      shortcut: getKey(),
      approved: true,
      remember: 'paths',
    })
  } else if (rememberLabel) {
    items.push({
      id: 'remember-patterns',
      label: rememberLabel,
      shortcut: getKey(),
      approved: true,
      remember: 'patterns',
    })
  }

  items.push({
    id: 'deny',
    label: 'Deny',
    shortcut: getKey(),
    approved: false,
  })

  items.push({
    id: 'abort',
    label: 'Abort',
    shortcut: getKey(),
    approved: false,
    abort: true,
  })

  return items
}

export function isApprovalRequested(part: { type: string; state?: string }) {
  return part.type.startsWith('tool-') && part.state === 'approval-requested'
}

export function summarizeInput(input: unknown): string {
  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>
    if (typeof record.command === 'string') return record.command
    if (typeof record.path === 'string') return record.path
  }
  return JSON.stringify(input ?? {}, null, 2)
}

export function getDescription(input: unknown): string | null {
  const description = (input as { description?: string } | undefined)
    ?.description
  return typeof description === 'string' && description.trim()
    ? description.trim()
    : null
}

export function getCommand(input: unknown): string | null {
  const command = (input as { command?: string } | undefined)?.command
  return typeof command === 'string' ? command : null
}

export function alwaysLabel(
  toolName: string,
  input: unknown,
  approvals: ToolApprovals | undefined,
): string | null {
  if (toolName !== 'shell') {
    return toolNamesForApproval(toolName).length > 1
      ? 'Allow edits for this session'
      : 'Always allow for this session'
  }

  const command = getCommand(input)
  if (command === null) return null

  const { unapproved } = analyzeShellCommand(command, approvals?.shell ?? [])
  if (unapproved.length === 0) return null

  return formatAlwaysAllowLabel(unapproved)
}

/** Why an otherwise covered call still needs approval. */
export type ApprovalHold = 'forbidden' | 'plan' | 'paths' | 'analysis' | null

// prettier-ignore
export const HOLD_HINTS: Record<NonNullable<ApprovalHold>, string> = {
  forbidden: 'This accesses a forbidden path and always requires approval.',
  plan: 'Plan mode is active and this command is not read-only.',
  paths: 'This command references git-ignored files or paths outside the workspace.',
  analysis: 'This command’s path operands cannot be verified statically.',
}

export function approvalHold(
  toolName: string,
  input: unknown,
  mode: string | undefined,
  pathStatus?: PathApprovalStatus,
): ApprovalHold {
  if (toolName !== 'shell') {
    const path = (input as { path?: string } | undefined)?.path
    return typeof path === 'string' && isPathForbidden(path)
      ? 'forbidden'
      : null
  }

  const command = getCommand(input)
  if (command === null) return null
  if (pathStatus === 'forbidden') return 'forbidden'
  if (mode === 'plan' && !isReadOnlyShellCommand(command)) return 'plan'
  return pathStatus ?? null
}

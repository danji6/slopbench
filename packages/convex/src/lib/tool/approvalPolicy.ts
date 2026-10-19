import { formatAlwaysAllowLabel } from '@sb/core/approval-label'
import { type ApprovalHold, getCommand } from '@sb/core/approval-presentation'
import type { PathApprovalStatus } from '@sb/core/workspace/path-policy'

import type { ToolApprovals } from '../../types'
import {
  analyzeShellCommand,
  isPathForbidden,
  isReadOnlyShellCommand,
  toolNamesForApproval,
} from './approval'

export type { ApprovalHold } from '@sb/core/approval-presentation'

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

// prettier-ignore
export const HOLD_HINTS: Record<NonNullable<ApprovalHold>, string> = {
  forbidden: 'This accesses a forbidden path and always requires approval.',
  plan: 'This command is not recognized as read-only. Plan mode requires approval each time, even if it is allowed for this session.',
  paths: 'This command references git-ignored files or paths outside the workspace.',
  analysis: 'This command’s file paths cannot be verified. Approval is required each time, even if the command is allowed for this session.',
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

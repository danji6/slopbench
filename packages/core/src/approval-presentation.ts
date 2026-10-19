import type { RememberScope } from './types/tools'

/** Explains why an otherwise remembered call still needs approval. */
export type ApprovalHold = 'forbidden' | 'plan' | 'paths' | 'analysis' | null

type RememberOption = { remember: RememberScope; label: string }

/** Selects the remember scope only when it can remove the current approval hold. */
export function approvalRememberOption(
  hold: ApprovalHold,
  label: string | null,
): RememberOption | undefined {
  if (hold === 'paths') {
    return {
      remember: 'paths',
      label: 'Allow access and edits to these paths for this session',
    }
  }
  if (hold === null && label) return { remember: 'patterns', label }
}

/** Describes plan transitions consistently across approval surfaces. */
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

export type PlanApprovalMeta = {
  heading: string
  approveLabel: string
  denyLabel: string
  denyAborts?: boolean
}

/** Reads a nonblank description supplied by the agent. */
export function getDescription(input: unknown): string | null {
  const description = (input as { description?: unknown } | undefined)
    ?.description
  return typeof description === 'string' && description.trim()
    ? description.trim()
    : null
}

export function getCommand(input: unknown): string | null {
  const command = (input as { command?: unknown } | undefined)?.command
  return typeof command === 'string' ? command : null
}

/** Selects the same command or path shown by the approval dialog. */
export function summarizeInput(input: unknown): string {
  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>
    if (typeof record.command === 'string') return record.command
    if (typeof record.path === 'string') return record.path
  }
  return JSON.stringify(input ?? {}, null, 2)
}

/** Describes one approval without exposing file contents in notifications. */
export function approvalSummary(toolName: string, input: unknown): string {
  const plan = PLAN_APPROVALS[toolName]
  if (plan) return plan.heading
  if (toolName === 'shell')
    return getDescription(input) ?? 'Run a shell command'
  return `${toolName}: ${summarizeInput(input)}`
}

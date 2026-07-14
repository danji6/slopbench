import type { Doc, Id } from '../_generated/dataModel'

export const TASK_TOOL_NAME = 'task'
export const TASK_TOOL_PART_TYPE = `tool-${TASK_TOOL_NAME}`

export type TaskToolInput = {
  agent_name: string
  prompt: string
  title?: string
}

export type TaskToolPart = {
  type: string
  toolCallId: string
  state?: string
  input?: unknown
  output?: unknown
  errorText?: string
  /** Available once a child session has been spawned for this call. */
  subagentSessionId?: string
}

export const SUBAGENT_REPORT_PART_TYPE = 'subagent-report'

/** Prefix of the resolved report text block (see INJECTED_BLOCK_PREFIXES). */
export const SUBAGENT_REPORT_PREFIX = '[Sub-agent report from'

export type SubagentReportStatus = 'complete' | 'failed' | 'stopped'

/**
 * A finished sub-agent's report, delivered to the parent session as its own
 * user-role message once the child stream settles.
 */
export type SubagentReportPart = {
  type: typeof SUBAGENT_REPORT_PART_TYPE
  sessionId: Id<'sessions'>
  agentName: string
  title?: string
  status: SubagentReportStatus
  text: string
}

export function isSubagentReportPart(
  part: unknown,
): part is SubagentReportPart {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    part.type === SUBAGENT_REPORT_PART_TYPE
  )
}

/** Renders a report part as the text block the provider sees. */
export function toSubagentReportBlock(part: SubagentReportPart): string {
  const title = part.title ? ` — ${part.title}` : ''
  return `${SUBAGENT_REPORT_PREFIX} ${part.agentName}${title} (${part.status})]\n\n${part.text}`
}

export function sharedSessionId(
  session: Pick<Doc<'sessions'>, '_id' | 'parent'>,
): Id<'sessions'> {
  // A child session acts under its parent's identity for shared,
  // session-scoped resources: the workspace binding and the plan
  return session.parent?.sessionId ?? session._id
}

export function isTaskPart(part: unknown): part is TaskToolPart {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    part.type === TASK_TOOL_PART_TYPE &&
    'toolCallId' in part &&
    typeof (part as TaskToolPart).toolCallId === 'string'
  )
}

/** Task calls that finished streaming but have no child session yet. */
export function pendingTaskParts(parts: unknown[]): TaskToolPart[] {
  return parts.filter(
    (part): part is TaskToolPart =>
      isTaskPart(part) &&
      part.state === 'input-available' &&
      !part.subagentSessionId,
  )
}

export function hasPendingTaskParts(parts: unknown[]): boolean {
  return pendingTaskParts(parts).length > 0
}

/** Task calls (spawned or not) that still lack an output. */
export function hasUnsettledTaskParts(parts: unknown[]): boolean {
  return parts.some(
    (part) => isTaskPart(part) && part.state === 'input-available',
  )
}

/**
 * Terminally settles task calls whose child never spawned (the turn was
 * stopped or failed before _suspendStep ran). Null when nothing was unsettled.
 */
export function settleAbandonedTaskParts(parts: unknown[]): unknown[] | null {
  if (!hasUnsettledTaskParts(parts)) return null
  return parts.map((part) =>
    isTaskPart(part) && part.state === 'input-available'
      ? {
          ...part,
          state: 'output-available',
          output: '[The turn ended before the sub-agent could be started.]',
        }
      : part,
  )
}

export function taskInput(part: TaskToolPart): TaskToolInput | null {
  const input = part.input
  if (typeof input !== 'object' || input === null) return null
  const typed = input as Record<string, unknown>
  if (typeof typed.agent_name !== 'string' || !typed.agent_name.trim()) {
    return null
  }
  if (typeof typed.prompt !== 'string' || !typed.prompt.trim()) return null
  return {
    agent_name: typed.agent_name.trim(),
    prompt: typed.prompt,
    ...(typeof typed.title === 'string' && typed.title.trim()
      ? { title: typed.title.trim() }
      : {}),
  }
}

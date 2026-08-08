/** Reason attached to an approval request that was never answered. */
export const UNRESOLVED_APPROVAL_REASON =
  'This tool call was denied and never ran. Do not retry the same call.'

/** Error attached to a tool call the turn ended on top of. */
export const UNFINISHED_TOOL_ERROR =
  'The turn ended before this tool call completed. Its effect, if any, is unknown.'

/**
 * States that, when the turn is over, mean the call was issued and no result
 * will ever arrive.
 */
const UNANSWERED_STATES = new Set([
  'input-streaming',
  'input-available',
  'approval-responded',
])

type ToolPartShape = {
  type?: unknown
  state?: unknown
  approval?: { id?: string }
}

/**
 * Settles an unanswered tool call, which otherwise converts to a `tool-call`
 * with no `tool-result`, which providers reject, leaving the client hanging.
 *
 * Only apply this once the turn is over.
 */
export function settleUnansweredToolPart<T>(part: T): T {
  const tool = part as ToolPartShape
  if (typeof tool?.type !== 'string' || !tool.type.startsWith('tool-')) {
    return part
  }

  if (tool.state === 'approval-requested') {
    if (!tool.approval?.id) return part
    return {
      ...tool,
      state: 'output-denied',
      approval: {
        id: tool.approval.id,
        approved: false,
        reason: UNRESOLVED_APPROVAL_REASON,
      },
    } as T
  }

  if (!UNANSWERED_STATES.has(tool.state as string)) return part
  return {
    ...tool,
    state: 'output-error',
    errorText: UNFINISHED_TOOL_ERROR,
  } as T
}

export function settleUnansweredToolParts<T>(parts: readonly T[]): T[] {
  return parts.map(settleUnansweredToolPart)
}

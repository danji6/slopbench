import { ASK_TOOL_NAME } from '../const'
import type { AskToolInput } from '../types'

export type PendingAskPart = {
  type: `tool-${typeof ASK_TOOL_NAME}`
  toolCallId: string
  state: 'input-available'
  input: AskToolInput
}

/** Narrows a persisted AI SDK part to a pending client-side Q&A call. */
export function isPendingAskPart(part: unknown): part is PendingAskPart {
  const typed = part as Partial<PendingAskPart>
  return (
    typed?.type === `tool-${ASK_TOOL_NAME}` &&
    typed.state === 'input-available' &&
    typeof typed.toolCallId === 'string'
  )
}

/** Whether a provider step still contains any unanswered Q&A calls. */
export function hasPendingQuestions(parts: readonly unknown[]): boolean {
  return parts.some(isPendingAskPart)
}

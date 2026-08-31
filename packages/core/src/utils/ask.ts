import { ASK_TOOL_NAME } from '../const'
import type {
  AgentQuestion,
  AskToolInput,
  AskToolOutput,
  UserAnswer,
  UserAnswerDraft,
} from '../types'

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

/** Derives the trusted model-facing output after response validation. */
export function deriveAskToolOutput(
  input: AskToolInput,
  drafts: UserAnswerDraft[],
  answeredBy: string,
): AskToolOutput {
  const byQuestion = new Map(
    drafts.map((draft) => [draft.questionIndex, draft]),
  )
  const answers = input.questions.map((question, questionIndex) =>
    deriveAnswer(question, questionIndex, byQuestion.get(questionIndex)!),
  )
  return { answeredBy, answers }
}

/** Converts one validated response without trusting client labels. */
function deriveAnswer(
  question: AgentQuestion,
  questionIndex: number,
  draft: UserAnswerDraft,
): UserAnswer {
  const base = { questionIndex, question: question.question.trim() }
  if (draft.skipped) return { ...base, skipped: true }

  const selected = draft.selectedOptionIndices ?? []
  if (!selected.length) {
    return { ...base, answer: draft.customAnswer!.trim() }
  }

  const labels = selected.map((index) => question.options[index]!.label.trim())
  const note = draft.note?.trim()
  return {
    ...base,
    answer: labels.join(', '),
    selectedOptionIndices: selected,
    ...(note && { note }),
  }
}

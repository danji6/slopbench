import { api } from '@sb/convex/_generated/api'
import type { AnswerQuestionsArgs } from '@sb/convex/types'
import type {
  AgentQuestion,
  AskToolInput,
  AskToolOutput,
  UserAnswerDraft,
} from '@sb/core/types'
import { hasPendingQuestions } from '@sb/core/utils/ask'
import type { ToolUIPart } from 'ai'
import type { OptimisticLocalStore } from 'convex/browser'

import type { AnswerDraft } from './question-draft-store'

export type AskPart = ToolUIPart & {
  type: 'tool-ask'
  state: 'input-available'
  input: AskToolInput
}

/** Narrows a message part to an unanswered question. */
export function isPendingQuestion(part: unknown): part is AskPart {
  const typed = part as { type?: unknown; state?: unknown }
  return typed?.type === 'tool-ask' && typed.state === 'input-available'
}

/** Hydrates answer state while discarding stale option indices. */
export function initialAnswers(
  questions: AgentQuestion[],
  saved: AnswerDraft[] | undefined,
): AnswerDraft[] {
  return questions.map((question, index) => {
    const value = saved?.[index]
    const selected = value?.selectedOptionIndex
    return {
      ...(Number.isInteger(selected) && question.options[selected!]
        ? { selectedOptionIndex: selected }
        : {}),
      customAnswer: value?.customAnswer ?? '',
      note: value?.note ?? '',
      skipped: value?.skipped === true,
    }
  })
}

/** Immutably updates one answer without coupling state logic to React. */
export function updateAnswer(
  answers: AnswerDraft[],
  index: number,
  update: (answer: AnswerDraft) => AnswerDraft,
) {
  return answers.map((answer, at) => (at === index ? update(answer) : answer))
}

/** Whether a question has an answer or was explicitly skipped. */
export function isAnswerComplete(answer: AnswerDraft) {
  return (
    answer.skipped ||
    answer.selectedOptionIndex !== undefined ||
    Boolean(answer.customAnswer.trim())
  )
}

/** Converts local picker state into the compact mutation payload. */
export function toAnswerDrafts(answers: AnswerDraft[]): UserAnswerDraft[] {
  return answers.map((answer, questionIndex) => ({
    questionIndex,
    ...(answer.skipped
      ? { skipped: true }
      : answer.selectedOptionIndex === undefined
        ? { customAnswer: answer.customAnswer.trim() }
        : {
            selectedOptionIndex: answer.selectedOptionIndex,
            ...(answer.note.trim() && { note: answer.note.trim() }),
          }),
  }))
}

/** Keeps restored navigation within the current request's bounds. */
export function clampQuestionIndex(index: number, length: number) {
  if (!Number.isInteger(index) || length <= 0) return 0
  return Math.max(0, Math.min(index, length - 1))
}

/** Mirrors a successful answer locally until query arrives. */
export function optimisticallyAnswer(
  store: OptimisticLocalStore,
  args: AnswerQuestionsArgs,
) {
  const stream = store.getQuery(api.chat.getActiveStream, {
    sessionId: args.sessionId,
  })
  if (!stream || stream.status !== 'awaiting_input') return

  let pendingQuestions = false
  let pendingApproval = false
  for (const { args: queryArgs, value } of store.getAllQueries(
    api.chat.messagesWindow,
  )) {
    if (!value || queryArgs.sessionId !== args.sessionId) continue
    const page = value.page.map((message) => {
      if (message._id !== stream.processingMessageId) return message
      return {
        ...message,
        segments: message.segments.map((segment) => ({
          ...segment,
          parts: segment.parts.map((part) => optimisticPart(part, args)),
        })),
      }
    })
    store.setQuery(api.chat.messagesWindow, queryArgs, { ...value, page })

    const target = page.find(({ _id }) => _id === stream.processingMessageId)
    const parts = target?.segments.flatMap(({ parts }) => parts) ?? []
    pendingQuestions ||= hasPendingQuestions(parts)
    pendingApproval ||= parts.some(isPendingApproval)
  }

  store.setQuery(
    api.chat.getActiveStream,
    { sessionId: args.sessionId },
    {
      ...stream,
      status: pendingQuestions
        ? 'awaiting_input'
        : pendingApproval
          ? 'awaiting_approval'
          : 'pending',
    },
  )
}

function optimisticPart(part: unknown, args: AnswerQuestionsArgs): unknown {
  if (!isPendingQuestion(part) || part.toolCallId !== args.toolCallId) {
    return part
  }

  const output: AskToolOutput = {
    answeredBy: 'You',
    answers: args.answers.map((answer) => {
      const question = part.input.questions[answer.questionIndex]!
      const selected = answer.selectedOptionIndex
      return {
        questionIndex: answer.questionIndex,
        question: question.question,
        answer: answer.skipped
          ? 'Skipped'
          : selected === undefined
            ? (answer.customAnswer?.trim() ?? '')
            : (question.options[selected]?.label ?? ''),
        ...(selected !== undefined && { selectedOptionIndex: selected }),
        ...(answer.note?.trim() && { note: answer.note.trim() }),
        ...(answer.skipped && { skipped: true }),
      }
    }),
  }
  return { ...part, state: 'output-available', output }
}

function isPendingApproval(part: unknown) {
  const typed = part as { type?: unknown; state?: unknown }
  return (
    typeof typed?.type === 'string' &&
    typed.type.startsWith('tool-') &&
    typed.state === 'approval-requested'
  )
}

import {
  MAX_ASK_OPTIONS,
  MAX_ASK_OPTION_DESCRIPTION_CHARS,
  MAX_ASK_OPTION_LABEL_CHARS,
  MAX_ASK_QUESTIONS,
  MAX_ASK_QUESTION_CHARS,
  MAX_ASK_RESPONSE_CHARS,
} from '@sb/core/limits'
import type {
  AgentQuestion,
  AskToolInput,
  AskToolOutput,
  UserAnswerDraft,
} from '@sb/core/types'
import { deriveAskToolOutput, isPendingAskPart } from '@sb/core/utils/ask'
import { toDisplayName } from '@sb/core/utils/names'

import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import type { AnswerQuestionsArgs } from '../../types'
import { getProcessingSegmentRow, patchSegmentParts } from '../messageContents'
import * as Memberships from '../session/memberships'
import { getByOwnerId as getSettingsByOwnerId } from '../settings'
import { resumeIfSettled } from '../stream/subagents'

/** Answers one pending client-executed Q&A call and resumes when possible. */
export async function answerQuestions(
  ctx: AuthMutationCtx,
  args: AnswerQuestionsArgs,
) {
  await Memberships.requireMember(ctx, args.sessionId, ctx.userId)

  const stream = await Memberships.getActiveStream(ctx, args.sessionId)
  if (
    !stream ||
    stream.status !== 'awaiting_input' ||
    !stream.processingMessageId
  ) {
    error('No question request is pending', 409)
  }

  const row = await getProcessingSegmentRow(ctx, stream)
  if (!row) error('Message not found', 404)

  const part = row.parts.find(
    (candidate) =>
      isPendingAskPart(candidate) && candidate.toolCallId === args.toolCallId,
  )
  if (!part || !isPendingAskPart(part)) {
    error('Question request not found', 409)
  }

  const settings = await getSettingsByOwnerId(ctx, ctx.userId)
  const output = buildAskToolOutput(
    part.input,
    args.answers,
    toDisplayName(settings?.displayName),
  )
  const parts = row.parts.map((candidate) =>
    candidate === part
      ? { ...part, state: 'output-available' as const, output }
      : candidate,
  )

  await patchSegmentParts(ctx, stream.processingMessageId, row, parts)
  await resumeIfSettled(ctx, stream, parts)
}

/** Validates untrusted stored tool input and derives the model-facing result. */
export function buildAskToolOutput(
  input: AskToolInput,
  drafts: UserAnswerDraft[],
  answeredBy: string,
): AskToolOutput {
  validateQuestions(input?.questions)
  if (drafts.length !== input.questions.length) {
    error('Every question must be answered')
  }

  const byQuestion = new Map<number, UserAnswerDraft>()
  for (const draft of drafts) {
    if (!Number.isInteger(draft.questionIndex)) {
      error('Question index must be an integer')
    }
    if (byQuestion.has(draft.questionIndex)) {
      error('Each question may only be answered once')
    }
    byQuestion.set(draft.questionIndex, draft)
  }

  input.questions.forEach((question, questionIndex) => {
    const draft = byQuestion.get(questionIndex)
    if (!draft) error('Every question must be answered')
    validateAnswer(question, draft)
  })

  return deriveAskToolOutput(input, drafts, answeredBy)
}

function validateQuestions(questions: AgentQuestion[] | undefined) {
  if (
    !Array.isArray(questions) ||
    questions.length < 1 ||
    questions.length > MAX_ASK_QUESTIONS
  ) {
    error(`A request must contain 1-${MAX_ASK_QUESTIONS} questions`)
  }

  for (const question of questions) {
    if (!question || typeof question !== 'object') {
      error('Each question must be an object')
    }
    assertBoundedText(question.question, MAX_ASK_QUESTION_CHARS, 'Question')
    if (
      !Array.isArray(question.options) ||
      question.options.length < 2 ||
      question.options.length > MAX_ASK_OPTIONS
    ) {
      error(`Each question must contain 2-${MAX_ASK_OPTIONS} options`)
    }

    const labels = new Set<string>()
    let recommended = 0
    for (const option of question.options) {
      if (!option || typeof option !== 'object') {
        error('Each option must be an object')
      }
      assertBoundedText(
        option.label,
        MAX_ASK_OPTION_LABEL_CHARS,
        'Option label',
      )
      const label = option.label.trim().toLowerCase()
      if (labels.has(label)) error('Option labels must be unique')
      labels.add(label)
      if (option.description !== undefined) {
        assertBoundedText(
          option.description,
          MAX_ASK_OPTION_DESCRIPTION_CHARS,
          'Option description',
        )
      }
      if (
        option.recommended !== undefined &&
        typeof option.recommended !== 'boolean'
      ) {
        error('Recommended must be a boolean')
      }
      if (option.recommended) recommended++
    }
    if (recommended > 1) error('At most one option may be recommended')
    if (
      question.multiple !== undefined &&
      typeof question.multiple !== 'boolean'
    ) {
      error('Multiple must be a boolean')
    }
  }
}

/** Validates one response against its trusted question definition. */
function validateAnswer(question: AgentQuestion, draft: UserAnswerDraft): void {
  const customAnswer = draft.customAnswer?.trim() ?? ''
  const note = draft.note?.trim() ?? ''
  const selected = draft.selectedOptionIndices ?? []
  const hasSelection = selected.length > 0
  const skipped = draft.skipped === true

  if (
    draft.customAnswer &&
    draft.customAnswer.length > MAX_ASK_RESPONSE_CHARS
  ) {
    error('Custom answer is too long')
  }
  if (draft.note && draft.note.length > MAX_ASK_RESPONSE_CHARS) {
    error('Answer note is too long')
  }
  if (draft.skipped !== undefined && typeof draft.skipped !== 'boolean') {
    error('Skipped must be a boolean')
  }
  if (
    draft.selectedOptionIndices !== undefined &&
    !Array.isArray(draft.selectedOptionIndices)
  ) {
    error('Selected option indices must be an array')
  }
  // prettier-ignore
  if (Number(hasSelection) + Number(Boolean(customAnswer)) + Number(skipped) !== 1) {
    error('Choose options, provide a custom answer, or skip the question')
  }
  if (!hasSelection && note) {
    error('Notes require a selected option')
  }
  if (!question.multiple && selected.length > 1) {
    error('This question only allows one selected option')
  }

  const unique = new Set(selected)
  if (
    unique.size !== selected.length ||
    selected.some(
      (index) => !Number.isInteger(index) || !question.options[index],
    )
  ) {
    error('Selected option is invalid')
  }
}

/** Enforces nonblank, bounded text after crossing a trust boundary. */
function assertBoundedText(value: unknown, max: number, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    error(`${label} must be between 1 and ${max} characters`)
  }
}

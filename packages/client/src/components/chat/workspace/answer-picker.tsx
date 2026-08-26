import {
  useActiveSession,
  useChatMessage,
  useStreamAwaitingAnswer,
  useStreamProcessingMessageId,
} from '@/hooks/chat'
import {
  type AskPart,
  clampQuestionIndex,
  initialAnswers,
  isAnswerComplete,
  isPendingQuestion,
  optimisticallyAnswer,
  toAnswerDrafts,
  updateAnswer,
} from '@/lib/chat/ask-tool'
import {
  type AnswerDraft,
  clearQuestionDraft,
  getQuestionDraft,
  questionDraftKey,
  setQuestionDraft,
} from '@/lib/chat/question-draft-store'
import { toastError } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { AgentQuestion } from '@sb/core/types'
import { useMutation } from 'convex/react'
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  AnswerPickerBody,
  AnswerPickerFooter,
  AnswerPickerHeader,
} from './answer-picker-content'

export type AnswerPickerProps = {
  className?: string
  restoreFocusRef?: RefObject<{ focus(options?: FocusOptions): void } | null>
  onAbort?: () => void
}

/** Locates the first pending Q&A call and mounts its persisted picker. */
export function AnswerPicker({
  className,
  restoreFocusRef,
  onAbort,
}: AnswerPickerProps) {
  const session = useActiveSession()
  const processingMessageId = useStreamProcessingMessageId()
  const awaitingAnswer = useStreamAwaitingAnswer()
  const { message } = useChatMessage(processingMessageId ?? '')
  const part = message?.parts.find(isPendingQuestion) as AskPart | undefined // prettier-ignore
  const draftKey = session && part ? questionDraftKey(session._id, part.toolCallId) : null // prettier-ignore

  useSettledDraftCleanup(session?._id, draftKey, awaitingAnswer)
  if (!awaitingAnswer || !session || !part || !draftKey) return null

  return (
    <AnswerForm
      key={part.toolCallId}
      sessionId={session._id}
      part={part}
      draftKey={draftKey}
      restoreFocusRef={restoreFocusRef}
      onAbort={onAbort}
      className={className}
    />
  )
}

type AnswerFormProps = {
  sessionId: Id<'sessions'>
  part: AskPart
  draftKey: string
  restoreFocusRef?: RefObject<{ focus(options?: FocusOptions): void } | null>
  onAbort?: () => void
  className?: string
}

/** Composes picker state, submission, keybinds, and the three UI regions. */
function AnswerForm({
  sessionId,
  part,
  draftKey,
  restoreFocusRef,
  onAbort,
  className,
}: AnswerFormProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const picker = usePickerState(part.input.questions, draftKey, rootRef)

  const submission = useAnswerSubmission({
    sessionId,
    part,
    draftKey,
    answers: picker.answers,
  })

  const question = part.input.questions[picker.questionIndex]!
  const answer = picker.answers[picker.questionIndex]!
  const completeCount = picker.answers.filter(isAnswerComplete).length
  const lastQuestion = picker.questionIndex === part.input.questions.length - 1

  const advance = useCallback(() => {
    if (!isAnswerComplete(answer)) return
    if (lastQuestion) void submission.submit()
    else picker.goTo(picker.questionIndex + 1)
  }, [lastQuestion, picker, answer, submission])

  usePickerFocus(rootRef, restoreFocusRef)

  useAnswerPickerKeybinds({
    rootRef,
    question,
    answer,
    questionIndex: picker.questionIndex,
    questionCount: part.input.questions.length,
    onNavigate: picker.goTo,
    onSelectOption: picker.selectOption,
    onAdvance: advance,
  })

  const abort = () => {
    clearQuestionDraft(draftKey)
    onAbort?.()
  }

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      data-slot="answer-picker"
      className={cn(
        'bg-m3-surface-container-low flex max-h-[min(70dvh,36rem)] w-full flex-col overflow-hidden rounded-xl border shadow-lg outline-none',
        className,
      )}
    >
      <AnswerPickerHeader
        questionIndex={picker.questionIndex}
        questionCount={part.input.questions.length}
        onNavigate={picker.goTo}
        onAbort={abort}
      />
      <AnswerPickerBody
        question={question}
        answer={answer}
        onSelectOption={picker.selectOption}
        onTextChange={picker.updateText}
      />
      <AnswerPickerFooter
        completeCount={completeCount}
        questionCount={part.input.questions.length}
        currentComplete={isAnswerComplete(answer)}
        skipped={answer.skipped}
        lastQuestion={lastQuestion}
        allComplete={completeCount === part.input.questions.length}
        submitting={submission.submitting}
        onToggleSkip={picker.toggleSkip}
        onAdvance={advance}
      />
    </div>
  )
}

/** Owns draft hydration, persistence, and edits for the current question. */
function usePickerState(
  questions: AgentQuestion[],
  draftKey: string,
  rootRef: RefObject<HTMLDivElement | null>,
) {
  const saved = useMemo(() => getQuestionDraft(draftKey), [draftKey])
  const [questionIndex, setQuestionIndex] = useState(() =>
    clampQuestionIndex(saved?.questionIndex ?? 0, questions.length),
  )
  const [answers, setAnswers] = useState<AnswerDraft[]>(() =>
    initialAnswers(questions, saved?.answers),
  )

  useEffect(() => {
    setQuestionDraft(draftKey, { questionIndex, answers })
  }, [answers, draftKey, questionIndex])

  const goTo = useCallback(
    (index: number) => {
      setQuestionIndex(clampQuestionIndex(index, questions.length))
      // Navigation buttons should hand keyboard shortcuts back to the picker.
      requestAnimationFrame(() =>
        rootRef.current?.focus({ preventScroll: true }),
      )
    },
    [questions.length, rootRef],
  )

  const updateCurrent = useCallback(
    (update: (answer: AnswerDraft) => AnswerDraft) => {
      setAnswers((current) => updateAnswer(current, questionIndex, update))
    },
    [questionIndex],
  )

  const selectOption = useCallback(
    (optionIndex: number) => {
      updateCurrent((value) => ({
        ...value,
        skipped: false,
        selectedOptionIndex:
          !value.skipped && value.selectedOptionIndex === optionIndex
            ? undefined
            : optionIndex,
      }))
    },
    [updateCurrent],
  )

  const updateText = useCallback(
    (text: string) => {
      updateCurrent((value) =>
        value.selectedOptionIndex === undefined
          ? { ...value, skipped: false, customAnswer: text }
          : { ...value, skipped: false, note: text },
      )
    },
    [updateCurrent],
  )

  const toggleSkip = useCallback(() => {
    updateCurrent((value) => ({ ...value, skipped: !value.skipped }))
  }, [updateCurrent])

  return {
    questionIndex,
    answers,
    goTo,
    selectOption,
    updateText,
    toggleSkip,
  }
}

type SubmissionArgs = {
  sessionId: Id<'sessions'>
  part: AskPart
  draftKey: string
  answers: AnswerDraft[]
}

/** Submits one complete batch and clears only the accepted local draft. */
function useAnswerSubmission({
  sessionId,
  part,
  draftKey,
  answers,
}: SubmissionArgs) {
  const [submitting, setSubmitting] = useState(false)

  const answerQuestions = useMutation(
    api.chat.answerQuestions,
  ).withOptimisticUpdate(optimisticallyAnswer)

  const submit = useCallback(async () => {
    if (!answers.every(isAnswerComplete) || submitting) return
    setSubmitting(true)
    try {
      await answerQuestions({
        sessionId,
        toolCallId: part.toolCallId,
        answers: toAnswerDrafts(answers),
      })
      clearQuestionDraft(draftKey)
    } catch (err) {
      // Convex rolls the optimistic part back to the accepted responder's data
      toastError(err)
      setSubmitting(false)
    }
  }, [answerQuestions, draftKey, part.toolCallId, answers, sessionId, submitting]) // prettier-ignore

  return { submit, submitting }
}

/** Restores focus to the composer host after the picker disappears. */
function usePickerFocus(
  rootRef: RefObject<HTMLDivElement | null>,
  restoreFocusRef?: RefObject<{ focus(options?: FocusOptions): void } | null>,
) {
  useEffect(() => {
    const restoreFocusTarget = restoreFocusRef?.current
    rootRef.current?.focus({ preventScroll: true })
    return () => restoreFocusTarget?.focus({ preventScroll: true })
  }, [restoreFocusRef, rootRef])
}

type KeybindArgs = {
  rootRef: RefObject<HTMLDivElement | null>
  question: AgentQuestion
  answer: AnswerDraft
  questionIndex: number
  questionCount: number
  onNavigate: (index: number) => void
  onSelectOption: (index: number) => void
  onAdvance: () => void
}

/** Keeps picker shortcuts out of the adaptive text field. */
function useAnswerPickerKeybinds({
  rootRef,
  question,
  answer,
  questionIndex,
  questionCount,
  onNavigate,
  onSelectOption,
  onAdvance,
}: KeybindArgs) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const root = rootRef.current
      if (!root || !root.contains(document.activeElement)) return

      const active = document.activeElement as HTMLElement | null
      const typing =
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLInputElement ||
        active?.isContentEditable

      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        onAdvance()
        return
      }
      if (typing) return

      const optionIndex = Number(event.key) - 1
      if (isOptionShortcut(event, optionIndex, question.options.length)) {
        event.preventDefault()
        onSelectOption(optionIndex)
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        onSelectOption(
          adjacentOptionIndex(
            answer.skipped ? undefined : answer.selectedOptionIndex,
            question.options.length,
            event.key === 'ArrowDown' ? 1 : -1,
          ),
        )
      } else if (event.key === 'ArrowLeft' && questionIndex > 0) {
        event.preventDefault()
        onNavigate(questionIndex - 1)
      } else if (
        event.key === 'ArrowRight' &&
        questionIndex < questionCount - 1
      ) {
        event.preventDefault()
        onNavigate(questionIndex + 1)
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [
    onAdvance,
    onNavigate,
    onSelectOption,
    question,
    questionCount,
    questionIndex,
    answer,
    rootRef,
  ])
}

/** Whether a bare number key maps to an available option. */
function isOptionShortcut(
  event: KeyboardEvent,
  optionIndex: number,
  optionCount: number,
) {
  return (
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    Number.isInteger(optionIndex) &&
    optionIndex >= 0 &&
    optionIndex < optionCount
  )
}

/** Wraps arrow key selection around the available option cards. */
function adjacentOptionIndex(
  selected: number | undefined,
  optionCount: number,
  direction: 1 | -1,
) {
  if (selected === undefined) return direction === 1 ? 0 : optionCount - 1
  return (selected + direction + optionCount) % optionCount
}

/** Clears the prior call's draft after settlement, abort, or responder races. */
function useSettledDraftCleanup(
  sessionId: string | undefined,
  draftKey: string | null,
  awaitingAnswer: boolean,
) {
  const previous = useRef<{ sessionId: string; draftKey: string } | null>(null)

  useEffect(() => {
    const last = previous.current
    if (
      last &&
      sessionId === last.sessionId &&
      (!awaitingAnswer || (draftKey !== null && draftKey !== last.draftKey))
    ) {
      clearQuestionDraft(last.draftKey)
    }
    if (sessionId && draftKey) previous.current = { sessionId, draftKey }
  }, [awaitingAnswer, draftKey, sessionId])
}

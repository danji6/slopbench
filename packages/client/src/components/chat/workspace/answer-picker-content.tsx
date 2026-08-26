import { RippleButton, Textarea } from '@/components/ui'
import type { AnswerDraft } from '@/lib/chat/question-draft-store'
import { cn } from '@/lib/utils'
import { MAX_ASK_RESPONSE_CHARS } from '@sb/core/limits'
import type { AgentQuestion } from '@sb/core/types'
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react'

type PickerHeaderProps = {
  questionIndex: number
  questionCount: number
  onNavigate: (index: number) => void
  onAbort: () => void
}

/** Fixed navigation and abort controls for the question batch. */
export function AnswerPickerHeader({
  questionIndex,
  questionCount,
  onNavigate,
  onAbort,
}: PickerHeaderProps) {
  return (
    <header className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b px-2">
      <div className="text-muted-foreground flex items-center text-sm tabular-nums">
        <RippleButton
          variant="stealth"
          size="icon-lg"
          aria-label="Previous question"
          disabled={questionIndex === 0}
          onClick={() => onNavigate(questionIndex - 1)}
        >
          <ChevronLeftIcon />
        </RippleButton>
        <span className="min-w-14 text-center">
          {questionIndex + 1} of {questionCount}
        </span>
        <RippleButton
          variant="stealth"
          size="icon-lg"
          aria-label="Next question"
          disabled={questionIndex === questionCount - 1}
          onClick={() => onNavigate(questionIndex + 1)}
        >
          <ChevronRightIcon />
        </RippleButton>
      </div>
      <RippleButton
        variant="stealth"
        size="icon-lg"
        aria-label="Abort agent turn"
        onClick={onAbort}
      >
        <XIcon />
      </RippleButton>
    </header>
  )
}

type QuestionBodyProps = {
  question: AgentQuestion
  answer: AnswerDraft
  onSelectOption: (optionIndex: number) => void
  onTextChange: (text: string) => void
}

/** Scrollable question, choices, and the single adaptive text field. */
export function AnswerPickerBody({
  question,
  answer,
  onSelectOption,
  onTextChange,
}: QuestionBodyProps) {
  const selectedOptionIndex = answer.skipped
    ? undefined
    : answer.selectedOptionIndex
  const selectionMode = answer.selectedOptionIndex !== undefined

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      <h2 className="text-foreground text-sm font-medium whitespace-pre-wrap">
        {question.question}
      </h2>
      <div
        className="space-y-1.5"
        role="radiogroup"
        aria-label={question.question}
      >
        {question.options.map((option, optionIndex) => (
          <OptionCard
            key={`${optionIndex}:${option.label}`}
            option={option}
            optionIndex={optionIndex}
            selected={selectedOptionIndex === optionIndex}
            onSelect={onSelectOption}
          />
        ))}
      </div>

      <Textarea
        variant="outline"
        maxLength={MAX_ASK_RESPONSE_CHARS}
        disabled={answer.skipped}
        value={
          answer.skipped
            ? ''
            : selectionMode
              ? answer.note
              : answer.customAnswer
        }
        onChange={(event) => onTextChange(event.target.value)}
        placeholder={
          answer.skipped
            ? 'Question skipped'
            : selectionMode
              ? 'Add context (optional)…'
              : 'Say something else…'
        }
        aria-label={selectionMode ? 'Additional context' : 'Custom answer'}
        className="max-h-28 min-h-16 rounded-lg text-sm"
      />
    </div>
  )
}

type OptionCardProps = {
  option: AgentQuestion['options'][number]
  optionIndex: number
  selected: boolean
  onSelect: (optionIndex: number) => void
}

/** Numbered choice card with optional recommendation metadata. */
function OptionCard({
  option,
  optionIndex,
  selected,
  onSelect,
}: OptionCardProps) {
  return (
    <RippleButton
      variant="input"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(optionIndex)}
      className={cn(
        'h-auto min-h-11 w-full justify-start rounded-lg px-3 py-2 text-left whitespace-normal',
        selected && 'border-primary bg-primary/10 ring-primary ring-1',
      )}
    >
      <kbd className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px]">
        {optionIndex + 1}
      </kbd>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span>{option.label}</span>
          {option.recommended && (
            <span className="bg-primary/15 text-primary rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase">
              Recommended
            </span>
          )}
        </span>
        {option.description && (
          <span className="text-muted-foreground mt-0.5 block text-xs font-normal">
            {option.description}
          </span>
        )}
      </span>
    </RippleButton>
  )
}

type PickerFooterProps = {
  completeCount: number
  questionCount: number
  currentComplete: boolean
  skipped: boolean
  lastQuestion: boolean
  allComplete: boolean
  submitting: boolean
  onToggleSkip: () => void
  onAdvance: () => void
}

/** Fixed completion controls, including an explicit reversible skip. */
export function AnswerPickerFooter({
  completeCount,
  questionCount,
  currentComplete,
  skipped,
  lastQuestion,
  allComplete,
  submitting,
  onToggleSkip,
  onAdvance,
}: PickerFooterProps) {
  return (
    <footer className="flex shrink-0 items-center justify-between gap-3 border-t p-3">
      <span className="text-muted-foreground text-xs tabular-nums">
        {completeCount}/{questionCount} complete
      </span>
      <div className="flex items-center gap-2">
        <RippleButton
          variant="stealth"
          aria-pressed={skipped}
          onClick={onToggleSkip}
          className={cn('min-h-11', skipped && 'bg-muted')}
        >
          {skipped ? 'Skipped' : 'Skip'}
        </RippleButton>
        <RippleButton
          disabled={
            !currentComplete || (lastQuestion && !allComplete) || submitting
          }
          onClick={onAdvance}
          className="min-h-11"
        >
          {lastQuestion ? 'Submit answers' : 'Next'}
        </RippleButton>
      </div>
    </footer>
  )
}

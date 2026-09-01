import { askBlockLabel } from '@/lib/chat/ask-tool'
import type { AskToolInput, AskToolOutput } from '@sb/core/types'

import type { ToolRendererProps } from './tool-part-block'
import { ToolShell } from './tool-shell'

/** Renders a compact pending or completed question. */
export function QuestionBlock(props: ToolRendererProps) {
  const input = props.part.input as AskToolInput | undefined
  const output =
    props.part.state === 'output-available'
      ? (props.part.output as AskToolOutput | undefined)
      : undefined
  const questions = input?.questions ?? []
  const count = questions.length
  const label = askBlockLabel(props.part.state, count, output)

  return (
    <ToolShell
      data-slot="question-block"
      {...props}
      dense
      label={<span className="text-foreground font-medium">{label}</span>}
    >
      {output?.aborted ? (
        <p className="text-muted-foreground text-xs">{output.reason}</p>
      ) : output ? (
        <ol className="space-y-3">
          {output.answers.map((answer) => (
            <li key={answer.questionIndex} className="space-y-1 text-xs">
              <div className="text-foreground font-medium whitespace-pre-wrap">
                {answer.question}
              </div>
              <div className="text-muted-foreground whitespace-pre-wrap">
                <span className="font-medium">{output.answeredBy}:</span>{' '}
                {answer.skipped ? <em>Skipped</em> : answer.answer}
              </div>
              {answer.note && (
                <div className="border-primary/40 text-muted-foreground ml-1 border-l-2 pl-2 whitespace-pre-wrap">
                  {answer.note}
                </div>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <ol className="text-muted-foreground list-decimal space-y-1 pl-4 text-xs">
          {questions.map((question, index) => (
            <li key={index} className="whitespace-pre-wrap">
              {question.question}
            </li>
          ))}
        </ol>
      )}
    </ToolShell>
  )
}

/** One choice offered for a question. */
export type AskOption = {
  label: string
  description?: string
  recommended?: boolean
}

/** A decision the agent needs the user to resolve. */
export type AgentQuestion = {
  question: string
  options: AskOption[]
  /** Allows the user to select more than one offered option. */
  multiple?: boolean
}

/** Input for the ask tool. */
export type AskToolInput = {
  questions: AgentQuestion[]
}

/** Untrusted response submitted by the client for one question. */
export type UserAnswerDraft = {
  questionIndex: number
  selectedOptionIndices?: number[]
  customAnswer?: string
  note?: string
  skipped?: boolean
}

/** Server-derived response returned to the model. */
type UserAnswerBase = {
  questionIndex: number
  question: string
}

export type UserAnswer = UserAnswerBase &
  (
    | {
        answer: string
        selectedOptionIndices?: number[]
        note?: string
        skipped?: false
      }
    | {
        skipped: true
        answer?: never
        selectedOptionIndices?: never
        note?: never
      }
  )

/** Result returned when the user dismisses the question batch. */
export type AbortedAskToolOutput = {
  aborted: true
  reason: string
}

/** Complete response batch returned to the requesting agent. */
export type AskToolOutput =
  | {
      answeredBy: string
      answers: UserAnswer[]
      aborted?: false
    }
  | AbortedAskToolOutput

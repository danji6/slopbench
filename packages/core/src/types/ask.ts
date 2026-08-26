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
}

/** Input for the ask tool. */
export type AskToolInput = {
  questions: AgentQuestion[]
}

/** Untrusted response submitted by the client for one question. */
export type UserAnswerDraft = {
  questionIndex: number
  selectedOptionIndex?: number
  customAnswer?: string
  note?: string
  skipped?: boolean
}

/** Server-derived response returned to the model. */
export type UserAnswer = {
  questionIndex: number
  question: string
  answer: string
  selectedOptionIndex?: number
  note?: string
  skipped?: boolean
}

/** Complete response batch returned to the requesting agent. */
export type AskToolOutput = {
  answeredBy: string
  answers: UserAnswer[]
}

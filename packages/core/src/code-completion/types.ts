/** Metadata shared by completion, call hints, and host-provided helpers. */
export type Completion = {
  label: string
  detail?: string
  description?: string
  kind?: 'variable' | 'function' | 'class' | 'parameter' | 'value'
  /** Literal insertion text; unlike snippets, dollar signs are preserved. */
  insertText?: string
  /** Supports $1, ${1:placeholder}, and the final caret $0. */
  snippet?: string
  params?: CompletionParameter[]
}

export type CompletionParameter = {
  name: string
  description?: string
  optional?: boolean
  /** Strings insert quoted values; objects supply literal JavaScript edits. */
  values?: readonly (string | CompletionValue)[]
}

export type CompletionValue = {
  label: string
  insertText: string
  description?: string
}

export type CompletionRange = { from: number; to: number }

export type CompletionRequest = {
  text: string
  offset: number
  language: string
  trigger: 'typing' | 'explicit' | 'triggerCharacter' | 'selection'
}

export type CompletionItem = Completion & CompletionRange

export type SignatureHelp = {
  label: string
  params: CompletionParameter[]
  activeParameter: number
  /** Source offset of the call's opening parenthesis. */
  from: number
}

export type CompletionResult = {
  items: CompletionItem[]
  signature?: SignatureHelp
}

export type CompletionProvider = (
  request: CompletionRequest,
) => CompletionResult | Promise<CompletionResult>

export type CompletionSource = readonly Completion[] | CompletionProvider

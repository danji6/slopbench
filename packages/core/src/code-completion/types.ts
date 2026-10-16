/** Metadata shared by completion, call hints, and host-provided helpers. */
export type Completion = {
  label: string
  detail?: string
  description?: string
  kind?: 'variable' | 'function' | 'class' | 'parameter' | 'property' | 'value'
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
  /** Fields offered inside an inline object literal. */
  properties?: readonly CompletionParameter[]
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

export type CompletionItem = Completion &
  CompletionRange & {
    /** Caret offset relative to the inserted text, preserving outer snippet stops. */
    caretOffset?: number
    /** Requests suggestions immediately after accepting this edit. */
    retrigger?: boolean
  }

export type SignatureHelp = {
  label: string
  params: CompletionParameter[]
  activeParameter: number
  activePropertyPath?: readonly string[]
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

import type { MessageRole } from './roles'

export type Prompt = {
  id: string
  name: string
  role: MessageRole
  content: string
  enabled: boolean
  visible: boolean
  starter?: boolean
}

export type ReminderPrompt = {
  id: string
  name: string
  role: MessageRole
  content: string
  enabled: boolean
  /** Injected as a hidden message every N logical turns. */
  interval: number
  /** Fire immediately when first seen instead of waiting a full interval. */
  eager?: boolean
}

export type PromptMarkerType =
  'message-history' | 'system-boundary' | 'agent-prompts'

export type PromptMarker = {
  type: PromptMarkerType
}

export type PromptItem = Prompt | PromptMarker

export type OrderedItem =
  | { kind: 'own'; id: string }
  | { kind: 'global'; id: string }
  | { kind: 'library'; id: string }

/** How an agent interleaves its prompts. */
export type PromptOrdering = {
  globalPromptsEnabled?: boolean
  promptOrder?: OrderedItem[]
}

/** An ordering with its prompts resolved, which is what merging consumes. */
export type PromptSource = PromptOrdering & {
  prompts: PromptItem[]
}

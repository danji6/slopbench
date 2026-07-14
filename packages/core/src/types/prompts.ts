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

export type PromptMarkerType = 'message-history' | 'agents'

export type PromptMarker = {
  id: string
  type: PromptMarkerType
}

export type PromptItem = Prompt | PromptMarker

export type OrderedItem =
  | { kind: 'own'; id: string }
  | { kind: 'global'; id: string }
  | { kind: 'library'; id: string }

export type PromptSource = {
  globalPromptsEnabled?: boolean
  prompts: PromptItem[]
  promptOrder?: OrderedItem[]
}

import type { ModelReasoning } from '@sb/core/types'

export type ProviderOption = {
  value: string
  label: string
  requiresBaseURL: boolean
  defaultReasoning: ModelReasoning
  binaryReasoningParameter?: string
}

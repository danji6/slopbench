import type { ModelReasoning } from '@cv/core/types'

export type ProviderOption = {
  value: string
  label: string
  requiresBaseURL: boolean
  defaultReasoning: ModelReasoning
  binaryReasoningParameter?: string
}

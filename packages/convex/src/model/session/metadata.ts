import type { Id } from '../../_generated/dataModel'
import type { ModelEntry } from '../../types'

type UsageTotals = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export type SessionMetadata = {
  usage?: UsageTotals
  model?: ModelEntry
  log?: Id<'_storage'>
}

export function setMetadataModel(
  metadata: SessionMetadata | undefined,
  model: ModelEntry | undefined,
): SessionMetadata {
  const next = { ...(metadata ?? {}) }
  if (model) {
    next.model = model
  } else {
    delete next.model
  }
  return next
}

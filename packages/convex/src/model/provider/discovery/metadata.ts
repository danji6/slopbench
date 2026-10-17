import type { InferenceParameters } from '@sb/core/types'

export function positive(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

export function inferenceDefaults(
  values?: Record<string, unknown> | null,
): InferenceParameters | undefined {
  const result: InferenceParameters = {}
  const fields = {
    temperature: 'temperature',
    top_p: 'topP',
    frequency_penalty: 'frequencyPenalty',
    presence_penalty: 'presencePenalty',
    repeat_penalty: 'repeatPenalty',
  } as const

  for (const [source, target] of Object.entries(fields)) {
    const value = values?.[source]
    if (typeof value === 'number' && Number.isFinite(value))
      result[target] = value
  }

  return Object.keys(result).length ? result : undefined
}

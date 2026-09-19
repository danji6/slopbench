import type { InferenceParameters } from '../../types'
import { type ProviderOptions } from './options'

export const NO_PENALTY_PROVIDERS = new Set(['anthropic', 'mistral'])

export function applyPenalties(
  result: ProviderOptions,
  providerId: string,
  params: Partial<InferenceParameters> | undefined,
): ProviderOptions {
  if (!params) return result

  const {
    temperature,
    topP,
    frequencyPenalty,
    presencePenalty,
    repeatPenalty,
  } = params

  const penaltyFields = NO_PENALTY_PROVIDERS.has(providerId)
    ? { temperature, topP }
    : { temperature, topP, frequencyPenalty, presencePenalty }

  if (providerId === 'ollama' && repeatPenalty !== undefined) {
    return {
      ...result,
      ...penaltyFields,
      providerOptions: {
        ...result.providerOptions,
        ollama: { repeat_penalty: repeatPenalty },
      },
    }
  }

  return { ...result, ...penaltyFields }
}

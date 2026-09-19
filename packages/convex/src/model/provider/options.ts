import type { SharedV3ProviderOptions } from '@ai-sdk/provider'
import { normalizeReasoningEffort } from '@sb/core/model-reasoning'
import type { LanguageModel } from 'ai'

import { error } from '../../errors'
import type { ReasoningEffort } from '../../types'
import { applyPenalties } from './inferenceOptions'
import { resolveModelReasoning } from './known'
import { createLanguageModel } from './modelFactory'
import type { ProviderCredentials } from './providers'
import { type ReasoningValue } from './reasoningOptions'
import { applyReasoning } from './reasoningOptions'
import { applyReasoningReplayPolicy } from './reasoningReplay'
import { createProviderFetch } from './request'

export { applyReasoningReplayPolicy } from './reasoningReplay'
export { getReasoningPartPolicy } from './reasoningReplay'
export { filterPromptReasoning } from './reasoningReplay'

export type ProviderOptions = {
  languageModel: LanguageModel
  providerOptions?: SharedV3ProviderOptions
  reasoning?: ReasoningValue
  temperature?: number
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
}

export async function getProviderOptions(
  model?: string,
  reasoningEffort?: ReasoningEffort,
  credentials?: ProviderCredentials | null,
  onRequest?: (body: string) => void | Promise<void>,
  fetchOverride?: typeof globalThis.fetch,
): Promise<ProviderOptions> {
  if (!model) {
    error('No model provided')
  }
  if (!credentials?.providerId) {
    error(
      `No provider configured for model "${model}". Please add a provider with this model in Settings → Models.`,
    )
  }

  const providerId = credentials.providerId
  const reasoning = resolveModelReasoning(
    providerId,
    credentials.model?.reasoning,
  )
  const normalizedEffort = normalizeReasoningEffort(reasoningEffort, reasoning)
  const requestFetch = createProviderFetch({
    providerId,
    reasoning,
    reasoningEffort: normalizedEffort,
    extraParameters: credentials.model?.extraParameters,
    extraHeaders: credentials.extraHeaders,
    onRequest,
    fetch: fetchOverride,
  })
  const created = await createLanguageModel(
    providerId,
    model,
    credentials,
    reasoning,
    normalizedEffort,
    requestFetch,
  )

  let result: ProviderOptions = {
    languageModel: await applyReasoningReplayPolicy(created, providerId),
  }
  result = await applyReasoning(result, providerId, model, normalizedEffort)
  result = applyPenalties(result, providerId, credentials.model?.inference)

  return result
}

import type { SharedV3ProviderOptions } from '@ai-sdk/provider'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { ModelReasoning, ReasoningTier } from '@sb/core/types'
import type { LanguageModelMiddleware } from 'ai'

import type { ReasoningEffort } from '../../types'
import { providerReasoningField } from './known'
import { FIRST_PARTY_PROVIDERS } from './modelFactory'
import { type ProviderOptions } from './options'

export const REASONING_TAGS: Record<string, string> = {
  qwen: 'reasoning',
  'qwen-coder': 'reasoning',
  deepseek: 'think',
  'deepseek-r1': 'think',
  llama: 'think',
  'llama-4': 'think',
  mistral: 'think',
}

// v7 exposes a provider-agnostic reasoning effort option that each provider
// maps to its native parameter. We only need to translate our `auto` sentinel.
export type ReasoningValue =
  'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export function getOllamaThink(
  reasoning: ModelReasoning | undefined,
  effort: ReasoningEffort | undefined,
): boolean | ReasoningTier {
  if (reasoning?.type === 'none') return false
  if (reasoning?.type === 'binary') return effort !== 'none'
  if (!effort || effort === 'auto') return true
  return effort === 'none' ? false : effort
}

export function toReasoningValue(
  effort: ReasoningEffort | undefined,
): ReasoningValue | undefined {
  if (!effort) return undefined
  if (effort === 'max') return undefined
  if (effort === 'auto') return 'provider-default'
  return effort
}

export async function applyReasoning(
  result: ProviderOptions,
  providerId: string,
  modelId: string,
  effort: ReasoningEffort | undefined,
): Promise<ProviderOptions> {
  switch (providerId) {
    case 'openrouter':
      return {
        ...result,
        providerOptions: buildOpenRouterReasoning(effort),
      }
  }

  const reasoning = toReasoningValue(effort)

  // Generic OpenAI-compatible endpoints don't emit structured reasoning. If the
  // model streams inline <think> tags, extract them into reasoning parts.
  if (!FIRST_PARTY_PROVIDERS.has(providerId) && effort && effort !== 'none') {
    const middleware = await buildReasoningMiddleware(providerId, modelId)
    if (middleware) {
      const { wrapLanguageModel } = await import('ai')
      return {
        ...result,
        reasoning,
        languageModel: wrapLanguageModel({
          model: result.languageModel as LanguageModelV3,
          middleware,
        }),
      }
    }
  }

  return { ...result, reasoning }
}

export function buildOpenRouterReasoning(
  effort: ReasoningEffort | undefined,
): SharedV3ProviderOptions | undefined {
  if (!effort || effort === 'auto') return undefined
  if (effort === 'max') return undefined
  return { openrouter: { reasoning: { effort } } }
}

export async function buildReasoningMiddleware(
  providerId: string,
  modelId: string,
): Promise<LanguageModelMiddleware | undefined> {
  const tag =
    providerReasoningField(providerId) != null
      ? 'reasoning'
      : getReasoningTag(modelId)
  if (!tag) return undefined
  const { extractReasoningMiddleware } = await import('ai')
  return extractReasoningMiddleware({ tagName: tag })
}

export function getReasoningTag(modelName: string): string | undefined {
  const lower = modelName.toLowerCase()
  for (const [key, tag] of Object.entries(REASONING_TAGS)) {
    if (lower.includes(key)) {
      return tag
    }
  }
  return undefined
}

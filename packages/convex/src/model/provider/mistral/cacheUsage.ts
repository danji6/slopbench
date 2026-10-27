import type { LanguageModelV4Usage } from '@ai-sdk/provider'
import type { LanguageModel } from 'ai'

import { withUsageAdapter } from '../usageMiddleware'

/** Preserves reported zero cache reads that the Mistral SDK otherwise drops. */
export function withMistralCacheUsage(model: LanguageModel) {
  return withUsageAdapter(model, reportedCacheUsage)
}

function reportedCacheUsage(usage: LanguageModelV4Usage): LanguageModelV4Usage {
  const raw = usage.raw
  const details = raw?.prompt_tokens_details ?? raw?.prompt_token_details
  const detailTokens =
    details && typeof details === 'object' && 'cached_tokens' in details
      ? details.cached_tokens
      : undefined
  const reportedTokens = raw?.num_cached_tokens ?? detailTokens

  return {
    ...usage,
    inputTokens: {
      ...usage.inputTokens,
      cacheRead:
        typeof reportedTokens === 'number' ? reportedTokens : undefined,
    },
  }
}

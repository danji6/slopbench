import type { LanguageModelV4Usage } from '@ai-sdk/provider'
import type { LanguageModel } from 'ai'

import { withUsageAdapter } from '../usageMiddleware'

/** Preserves missing cache reporting that the OpenAI SDK otherwise defaults to zero. */
export function withOpenAICacheUsage(model: LanguageModel) {
  return withUsageAdapter(model, reportedCacheUsage)
}

function reportedCacheUsage(usage: LanguageModelV4Usage): LanguageModelV4Usage {
  const details =
    usage.raw?.input_tokens_details ?? usage.raw?.prompt_tokens_details
  const reportedTokens =
    details && typeof details === 'object' && 'cached_tokens' in details
      ? details.cached_tokens
      : undefined

  return {
    ...usage,
    inputTokens: {
      ...usage.inputTokens,
      cacheRead:
        typeof reportedTokens === 'number' ? reportedTokens : undefined,
    },
  }
}

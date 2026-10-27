import type { InferenceAdapter } from '../inferenceTypes'
import { withMistralCacheUsage } from './cacheUsage'

export const create: InferenceAdapter = async ({
  modelId,
  baseURL,
  apiKey,
  requestFetch,
}) => {
  const { createMistral } = await import('@ai-sdk/mistral')
  return withMistralCacheUsage(
    createMistral({ baseURL, apiKey, fetch: requestFetch })(modelId),
  )
}

import type { InferenceAdapter } from '../inferenceTypes'
import { withOpenAICacheUsage } from './cacheUsage'

export const create: InferenceAdapter = async ({
  modelId,
  baseURL,
  apiKey,
  requestFetch,
}) => {
  const { createOpenAI } = await import('@ai-sdk/openai')
  return withOpenAICacheUsage(
    createOpenAI({ baseURL, apiKey, fetch: requestFetch })(modelId),
  )
}

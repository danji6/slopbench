import type { InferenceAdapter } from '../inferenceTypes'

export const create: InferenceAdapter = async ({
  modelId,
  baseURL,
  apiKey,
  requestFetch,
}) => {
  const { createAnthropic } = await import('@ai-sdk/anthropic')
  return createAnthropic({ baseURL, apiKey, fetch: requestFetch })(modelId)
}

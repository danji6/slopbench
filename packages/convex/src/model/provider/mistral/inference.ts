import type { InferenceAdapter } from '../inferenceTypes'

export const create: InferenceAdapter = async ({
  modelId,
  baseURL,
  apiKey,
  requestFetch,
}) => {
  const { createMistral } = await import('@ai-sdk/mistral')
  return createMistral({ baseURL, apiKey, fetch: requestFetch })(modelId)
}

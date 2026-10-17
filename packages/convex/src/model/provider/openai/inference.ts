import type { InferenceAdapter } from '../inferenceTypes'

export const create: InferenceAdapter = async ({
  modelId,
  baseURL,
  apiKey,
  requestFetch,
}) => {
  const { createOpenAI } = await import('@ai-sdk/openai')
  return createOpenAI({ baseURL, apiKey, fetch: requestFetch })(modelId)
}

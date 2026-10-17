import type { InferenceAdapter } from '../inferenceTypes'

export const create: InferenceAdapter = async ({
  modelId,
  baseURL,
  apiKey,
  requestFetch,
}) => {
  const { createMoonshotAI } = await import('@ai-sdk/moonshotai')
  return createMoonshotAI({ baseURL, apiKey, fetch: requestFetch })(modelId)
}

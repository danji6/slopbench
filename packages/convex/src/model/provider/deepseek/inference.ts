import type { InferenceAdapter } from '../inferenceTypes'

export const create: InferenceAdapter = async ({
  modelId,
  baseURL,
  apiKey,
  requestFetch,
}) => {
  const { createDeepSeek } = await import('@ai-sdk/deepseek')
  return createDeepSeek({ baseURL, apiKey, fetch: requestFetch })(modelId)
}

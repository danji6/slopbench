import type { InferenceAdapter } from '../inferenceTypes'

export const create: InferenceAdapter = async ({
  modelId,
  baseURL,
  apiKey,
  requestFetch,
}) => {
  const { createAlibaba } = await import('@ai-sdk/alibaba')
  return createAlibaba({ baseURL, apiKey, fetch: requestFetch })(modelId)
}

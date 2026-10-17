import type { InferenceAdapter } from '../inferenceTypes'

export const create: InferenceAdapter = async ({
  modelId,
  baseURL,
  apiKey,
  requestFetch,
}) => {
  const { createOpenRouter } = await import('@openrouter/ai-sdk-provider')
  return createOpenRouter({ baseURL, apiKey, fetch: requestFetch })(modelId, {
    usage: { include: true },
  })
}

import { error } from '@sb/convex/errors'

import type { InferenceAdapter } from '../inferenceTypes'
import { withOpenAICacheUsage } from '../openai/cacheUsage'

export const create: InferenceAdapter = async ({
  providerId,
  modelId,
  baseURL,
  apiKey,
  requestFetch,
}) => {
  const { createOpenAI } = await import('@ai-sdk/openai')
  if (!baseURL) error('Provider URL not specified.')
  const responses = providerId !== 'qwen' && baseURL.endsWith('/responses')
  const normalized = baseURL.replace(/\/(responses|chat\/completions)$/, '')
  const client = createOpenAI({
    baseURL: normalized,
    apiKey,
    fetch: requestFetch,
  })
  return withOpenAICacheUsage(
    responses ? client.responses(modelId) : client.chat(modelId),
  )
}

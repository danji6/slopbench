import type { InferenceAdapter } from '../inferenceTypes'
import { createOllamaModel } from '../modelFactory'

export const create: InferenceAdapter = ({
  modelId,
  baseURL,
  apiKey,
  reasoning,
  reasoningEffort,
  requestFetch,
}) =>
  createOllamaModel(
    modelId,
    baseURL,
    apiKey,
    reasoning,
    reasoningEffort,
    requestFetch,
  )

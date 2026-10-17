import type { InferenceParameters, ModelReasoning } from './types/providers'

export type DiscoveredModel = {
  id: string
  label?: string
  contextWindow?: number
  reasoning?: ModelReasoning
  outputLimit?: number
  supportedParameters?: string[]
  inference?: InferenceParameters
  detailsLoaded?: boolean
  detailKey?: string
}

export type DiscoveryConnection = {
  id: string
  auth?: 'apiKey' | 'chatgpt'
  baseURL?: string
  apiKey?: string
  extraHeaders?: string
}

export const DISCOVERY_MAX_MODELS = 5000
export const DISCOVERY_STALE_MS = 24 * 60 * 60 * 1000

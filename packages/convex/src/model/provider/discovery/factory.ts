import type { DiscoveryConnection } from '@sb/core/model-discovery'

import { anthropicAdapter } from './anthropic'
import { ollamaAdapter } from './ollama'
import { chatGPTAdapter, openAIAdapter } from './openai'
import { openRouterAdapter } from './openrouter'
import type { DiscoveryAdapter } from './types'

const adapters: Record<string, DiscoveryAdapter> = {
  openai: openAIAdapter,
  anthropic: anthropicAdapter,
  openrouter: openRouterAdapter,
  ollama: ollamaAdapter,
}

export function discoveryAdapter(connection: DiscoveryConnection) {
  const adapter =
    connection.id === 'openai' && connection.auth === 'chatgpt'
      ? chatGPTAdapter
      : adapters[connection.id]
  if (!adapter)
    throw new Error('Model discovery is not supported for this provider')
  return adapter
}

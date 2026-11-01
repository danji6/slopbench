import type { ProviderTransportObserver } from '@sb/core/provider-continuity'

import {
  CHATGPT_OPENAI_OPTIONS,
  chatGPTFetch,
  chatGPTRequest,
  withChatGPTPolicy,
} from './openai/chatgpt'
import type { ProviderCredentials } from './providers'

export function inferenceTransport(
  connection: ProviderCredentials,
  cacheKey?: string,
  observeTransport?: ProviderTransportObserver,
) {
  return connection.providerId === 'openai' && connection.auth === 'chatgpt'
    ? {
        fetch: chatGPTFetch(connection, observeTransport),
        transformRequest: chatGPTRequest(connection, cacheKey),
        options: CHATGPT_OPENAI_OPTIONS,
        wrap: withChatGPTPolicy,
      }
    : undefined
}

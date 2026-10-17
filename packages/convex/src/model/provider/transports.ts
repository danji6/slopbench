import {
  CHATGPT_OPENAI_OPTIONS,
  chatGPTFetch,
  chatGPTRequest,
  withChatGPTPolicy,
} from './openai/chatgpt'
import type { ProviderCredentials } from './providers'

export function inferenceTransport(connection: ProviderCredentials) {
  return connection.providerId === 'openai' && connection.auth === 'chatgpt'
    ? {
        fetch: chatGPTFetch(connection),
        transformRequest: chatGPTRequest(connection),
        options: CHATGPT_OPENAI_OPTIONS,
        wrap: withChatGPTPolicy,
      }
    : undefined
}

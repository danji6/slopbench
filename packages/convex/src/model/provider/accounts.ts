import type { ModelProviderConfig } from '@sb/core/types'

import { chatGPTAccount } from './openai/account'

/** Resolves account operations independently of provider settings and inference. */
export function accountAdapter(connection: ModelProviderConfig) {
  return connection.id === 'openai' && connection.auth === 'chatgpt'
    ? chatGPTAccount
    : undefined
}

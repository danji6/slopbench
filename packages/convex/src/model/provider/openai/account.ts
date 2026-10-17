import type { ModelProviderConfig } from '@sb/core/types'

import { postSidecar } from '../../sidecar'

export type AccountStatus = {
  status: string
  planEnabled: boolean
  email?: string
  registration?: string
  message?: string
}

function key(c: ModelProviderConfig) {
  return { ownerId: c.ownerId, connectionId: c.connectionId }
}

export const chatGPTAccount = {
  status: (c: ModelProviderConfig): Promise<AccountStatus> =>
    postSidecar('/providers/chatgpt/status', key(c)),
  start: (
    c: ModelProviderConfig,
  ): Promise<{ url: string; expiresAt: number }> =>
    postSidecar('/providers/chatgpt/start', key(c)),
  disconnect: (c: ModelProviderConfig): Promise<{ revoked: boolean }> =>
    postSidecar('/providers/chatgpt/disconnect', key(c)),
  cancel: (c: ModelProviderConfig) =>
    postSidecar('/providers/chatgpt/cancel', key(c)),
  setup: async (c: ModelProviderConfig) =>
    JSON.stringify(
      await postSidecar('/providers/chatgpt/prepare-transfer', key(c)),
      null,
      2,
    ),
  modelsFetch: (c: ModelProviderConfig) =>
    (async () =>
      new Response(
        JSON.stringify(await postSidecar('/providers/chatgpt/models', key(c))),
      )) as unknown as typeof fetch,
}

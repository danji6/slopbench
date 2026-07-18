import type { ModelMessage } from '@ai-sdk/provider-utils'

const ANTHROPIC_CACHE_CONTROL = { type: 'ephemeral' } as const

const ANTHROPIC_TRAILING_BREAKPOINTS = 2

export type CacheableRequest = {
  systemPrompt: string | undefined
  messages: ModelMessage[]
}

/** Adds prompt cache breakpoints. Currently Anthropic only. */
export function applyPromptCaching(
  request: CacheableRequest,
  providerId: string | undefined,
): CacheableRequest {
  if (providerId !== 'anthropic') return request

  const messages = request.messages.map((message, index) =>
    request.messages.length - index <= ANTHROPIC_TRAILING_BREAKPOINTS
      ? withCacheControl(message)
      : message,
  )

  if (request.systemPrompt) {
    messages.unshift(
      withCacheControl({ role: 'system', content: request.systemPrompt }),
    )
    return { systemPrompt: undefined, messages }
  }

  return { systemPrompt: undefined, messages }
}

function withCacheControl(message: ModelMessage): ModelMessage {
  return {
    ...message,
    providerOptions: {
      ...message.providerOptions,
      anthropic: {
        ...message.providerOptions?.anthropic,
        cacheControl: ANTHROPIC_CACHE_CONTROL,
      },
    },
  } as ModelMessage
}

import type { LanguageModelV4 } from '@ai-sdk/provider'
import { prepareChatGPTRequest } from '@cv/core/chatgpt-policy'
import { APP_ID, APP_NAME } from '@cv/core/const'
import { parseModelExtraParameters } from '@cv/core/model-parameters'
import type { ProviderTransportObserver } from '@cv/core/provider-continuity'
import type { InferenceParameters } from '@cv/core/types'
import type { LanguageModel } from 'ai'

import { sidecarUrl } from '../../sidecar'
import { sidecarRequest } from '../../sidecarTransport'
import type { ProviderCredentials } from '../providers'
import { filterPromptReasoning } from '../reasoningReplay'
import { fetchChatGPTResponse } from './transport'

export const CHATGPT_OPENAI_OPTIONS = {
  store: false,
  systemMessageMode: 'developer',
  forceReasoning: true,
} as const

/** Routes OAuth requests through the sidecar without exporting its credentials. */
export function chatGPTFetch(
  credentials: ProviderCredentials,
  observeTransport?: ProviderTransportObserver,
): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof init?.body !== 'string') {
      throw new Error('Invalid ChatGPT inference request')
    }
    const body = prepareChatGPTRequest(JSON.parse(init.body))
    const context = await observeTransport?.(body)
    return fetchChatGPTResponse(
      `${sidecarUrl()}/providers/chatgpt/responses`,
      sidecarRequest({
        method: 'POST',
        signal: init.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: credentials.ownerId,
          connectionId: credentials.connectionId,
          body,
          continuity: context?.continuity,
        }),
      }),
      context,
    )
  }) as typeof fetch
}

/** Preserves replayable content and places client tools in the subscription namespace. */
export async function withChatGPTPolicy(
  languageModel: LanguageModel,
): Promise<LanguageModel> {
  const { wrapLanguageModel } = await import('ai')
  return wrapLanguageModel({
    model: languageModel as LanguageModelV4,
    middleware: {
      specificationVersion: 'v4',
      transformParams: async ({ params }) => {
        for (const message of params.prompt) {
          if (typeof message.content === 'string') continue
          for (const part of message.content) {
            if (part.type === 'file' && /^(audio|video)\//.test(part.mediaType))
              throw new Error(
                'ChatGPT plan access does not support audio or video inputs',
              )
          }
        }
        return {
          ...params,
          providerOptions: {
            ...params.providerOptions,
            openai: {
              ...params.providerOptions?.openai,
              ...CHATGPT_OPENAI_OPTIONS,
            },
          },
          tools: params.tools?.map((tool) =>
            tool.type === 'function'
              ? {
                  ...tool,
                  providerOptions: {
                    ...tool.providerOptions,
                    openai: {
                      ...tool.providerOptions?.openai,
                      namespace: {
                        name: APP_ID,
                        description: `Tools executed by ${APP_NAME}`,
                      },
                    },
                  },
                }
              : tool,
          ),
          prompt: filterPromptReasoning(params.prompt, (part) => {
            const encrypted =
              part.providerOptions?.openai?.reasoningEncryptedContent
            return typeof encrypted === 'string'
              ? {
                  ...part,
                  providerOptions: {
                    openai: { reasoningEncryptedContent: encrypted },
                  },
                }
              : null
          }),
        }
      },
    },
  })
}

/** Preserves explicit user parameters even when the SDK omits unsupported settings. */
export function chatGPTRequest(
  credentials: ProviderCredentials,
  cacheKey: string = crypto.randomUUID(),
) {
  const inference = credentials.model?.inference
  const explicit: Record<string, unknown> = {}

  const fields = {
    temperature: 'temperature',
    topP: 'top_p',
    frequencyPenalty: 'frequency_penalty',
    presencePenalty: 'presence_penalty',
    repeatPenalty: 'repeat_penalty',
  } as const

  for (const [source, target] of Object.entries(fields)) {
    const value = inference?.[source as keyof InferenceParameters]
    if (value !== undefined) explicit[target] = value
  }

  const extras = parseModelExtraParameters(credentials.model?.extraParameters)

  return (body: Record<string, unknown>) =>
    prepareChatGPTRequest({
      prompt_cache_key: cacheKey,
      ...body,
      ...explicit,
      ...extras,
    })
}

import type { LanguageModelV4 } from '@ai-sdk/provider'
import { prepareChatGPTRequest } from '@sb/core/chatgpt-policy'
import { parseModelExtraParameters } from '@sb/core/model-parameters'
import type { InferenceParameters } from '@sb/core/types'
import type { LanguageModel } from 'ai'

import { sidecarUrl } from '../../sidecar'
import { sidecarRequest } from '../../sidecarTransport'
import type { ProviderCredentials } from '../providers'
import { filterPromptReasoning } from '../reasoningReplay'

export const CHATGPT_OPENAI_OPTIONS = {
  store: false,
  systemMessageMode: 'developer',
  forceReasoning: true,
} as const

/** Routes OAuth requests through the sidecar without exporting its credentials. */
export function chatGPTFetch(credentials: ProviderCredentials): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof init?.body !== 'string')
      throw new Error('Invalid ChatGPT inference request')

    const body = prepareChatGPTRequest(JSON.parse(init.body))

    return fetch(
      `${sidecarUrl()}/providers/chatgpt/responses`,
      sidecarRequest({
        method: 'POST',
        signal: init.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: credentials.ownerId,
          connectionId: credentials.connectionId,
          body,
        }),
      }),
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
                        name: 'slopbench',
                        description: 'Tools executed by Slopbench',
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
export function chatGPTRequest(credentials: ProviderCredentials) {
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
    prepareChatGPTRequest({ ...body, ...explicit, ...extras })
}

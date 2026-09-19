import type { ModelReasoning } from '@sb/core/types'
import type { LanguageModel, LanguageModelMiddleware } from 'ai'

import { error } from '../../errors'
import type { ReasoningEffort } from '../../types'
import { providerRequiresBaseURL, resolveChatCompletionsBaseURL } from './known'
import { withProviderMiddleware } from './providerMiddleware'
import type { ProviderCredentials } from './providers'
import { getOllamaThink } from './reasoningOptions'

// Providers we construct explicitly (all others fall through to the generic
// OpenAI-compatible branch in `createLanguageModel`).
export const FIRST_PARTY_PROVIDERS = new Set([
  'anthropic',
  'deepseek',
  'mistral',
  'openai',
  'openrouter',
  'ollama',
])

export async function createLanguageModel(
  providerId: string,
  modelId: string,
  credentials?: ProviderCredentials,
  reasoning?: ModelReasoning,
  reasoningEffort?: ReasoningEffort,
  requestFetch?: typeof fetch,
): Promise<LanguageModel> {
  const baseURL = credentials?.baseURL
  const apiKey = credentials?.apiKey || undefined
  if (providerRequiresBaseURL(providerId) && !baseURL) {
    error('Provider URL not specified.')
  }

  const videoModel = await createVideoModel({
    providerId,
    modelId,
    baseURL,
    apiKey,
    requestFetch,
  })

  const withMiddleware = (model: LanguageModel) =>
    withProviderMiddleware({ model, videoModel })

  switch (providerId) {
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      return withMiddleware(
        createAnthropic({ apiKey, baseURL, fetch: requestFetch })(modelId),
      )
    }
    case 'alibaba': {
      const { createAlibaba } = await import('@ai-sdk/alibaba')
      return withMiddleware(
        createAlibaba({ apiKey, baseURL, fetch: requestFetch })(modelId),
      )
    }
    case 'deepseek': {
      const { createDeepSeek } = await import('@ai-sdk/deepseek')
      return withMiddleware(
        createDeepSeek({ apiKey, baseURL, fetch: requestFetch })(modelId),
      )
    }
    case 'mistral': {
      const { createMistral } = await import('@ai-sdk/mistral')
      return withMiddleware(
        createMistral({ apiKey, baseURL, fetch: requestFetch })(modelId),
      )
    }
    case 'moonshotai': {
      const { createMoonshotAI } = await import('@ai-sdk/moonshotai')
      const model = createMoonshotAI({ apiKey, baseURL, fetch: requestFetch })(
        modelId,
      )
      return withMiddleware(model)
    }
    case 'ollama': {
      return withMiddleware(
        await createOllamaModel(
          modelId,
          baseURL,
          apiKey,
          reasoning,
          reasoningEffort,
          requestFetch,
        ),
      )
    }
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return withMiddleware(
        createOpenAI({ apiKey, baseURL, fetch: requestFetch })(modelId),
      )
    }
    case 'openrouter': {
      const { createOpenRouter } = await import('@openrouter/ai-sdk-provider')
      return withMiddleware(
        createOpenRouter({ apiKey, baseURL, fetch: requestFetch })(modelId, {
          usage: { include: true },
        }),
      )
    }
    case 'qwen': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      const model = createOpenAI({
        apiKey,
        baseURL,
        fetch: requestFetch,
      }).chat(modelId)
      return withMiddleware(model)
    }
    default: {
      if (!baseURL) error('Provider URL not specified.')
      const { createOpenAI } = await import('@ai-sdk/openai')

      if (baseURL.endsWith('/responses')) {
        const model = createOpenAI({
          apiKey,
          baseURL: baseURL.slice(0, -'/responses'.length),
          fetch: requestFetch,
        }).responses(modelId)
        return withMiddleware(model)
      }

      const chatBase = baseURL.endsWith('/chat/completions')
        ? baseURL.slice(0, -'/chat/completions'.length)
        : baseURL

      const model = createOpenAI({
        apiKey,
        baseURL: chatBase,
        fetch: requestFetch,
      }).chat(modelId)
      return withMiddleware(model)
    }
  }
}

/** A model API that handles video uploads, currently by using the MoonshotAI API. */
export async function createVideoModel({
  providerId,
  modelId,
  baseURL,
  apiKey,
  requestFetch,
}: {
  providerId: string
  modelId: string
  baseURL?: string
  apiKey?: string
  requestFetch?: typeof fetch
}): Promise<LanguageModel | undefined> {
  const chatBaseURL = resolveChatCompletionsBaseURL(providerId, baseURL)
  if (!chatBaseURL) return undefined

  const { createMoonshotAI } = await import('@ai-sdk/moonshotai')
  return createMoonshotAI({
    apiKey,
    baseURL: chatBaseURL,
    fetch: requestFetch,
  })(modelId)
}

export async function createOllamaModel(
  modelId: string,
  baseURL: string | undefined,
  apiKey: string | undefined,
  reasoning: ModelReasoning | undefined,
  reasoningEffort: ReasoningEffort | undefined,
  requestFetch: typeof fetch | undefined,
): Promise<LanguageModel> {
  const [{ createOllama }, { wrapLanguageModel }] = await Promise.all([
    import('ai-sdk-ollama'),
    import('ai'),
  ])

  let abortSignal: AbortSignal | undefined

  const fetchWithAbort = ((input: RequestInfo | URL, init?: RequestInit) => {
    const signals = [init?.signal, abortSignal].filter((s): s is AbortSignal => s != null) // prettier-ignore
    const signal = signals.length ? AbortSignal.any(signals) : undefined
    return (requestFetch ?? fetch)(input, { ...init, signal })
  }) as typeof fetch // Bun fix

  const model = createOllama({ baseURL, apiKey, fetch: fetchWithAbort })(
    modelId,
    // ollama-js omits Ollama's documented `max` value from its current type.
    { think: getOllamaThink(reasoning, reasoningEffort) as never },
  )

  // Fix for Ollama not forwarding the AI SDK's `abortSignal`
  const abortMiddleware: LanguageModelMiddleware = {
    wrapStream: async ({ doStream, params }) => {
      abortSignal = params.abortSignal
      return doStream()
    },
  }

  return wrapLanguageModel({ model, middleware: abortMiddleware })
}

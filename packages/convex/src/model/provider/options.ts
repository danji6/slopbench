import type { SharedV3ProviderOptions } from '@ai-sdk/provider'
import type {
  LanguageModelV3,
  LanguageModelV4Message,
  LanguageModelV4Prompt,
  LanguageModelV4ReasoningPart,
} from '@ai-sdk/provider'
import { normalizeReasoningEffort } from '@sb/core/model-reasoning'
import type { ModelReasoning, ReasoningTier } from '@sb/core/types'
import type { LanguageModel, LanguageModelMiddleware } from 'ai'

import { error } from '../../errors'
import type { InferenceParameters, ReasoningEffort } from '../../types'
import {
  providerReasoningField,
  providerRequiresBaseURL,
  resolveChatCompletionsBaseURL,
  resolveModelReasoning,
} from './known'
import { withProviderMiddleware } from './providerMiddleware'
import type { ProviderCredentials } from './providers'
import { createProviderFetch } from './request'

const REASONING_TAGS: Record<string, string> = {
  qwen: 'reasoning',
  'qwen-coder': 'reasoning',
  deepseek: 'think',
  'deepseek-r1': 'think',
  llama: 'think',
  'llama-4': 'think',
  mistral: 'think',
}

const NO_PENALTY_PROVIDERS = new Set(['anthropic', 'mistral'])

// Providers we construct explicitly (all others fall through to the generic
// OpenAI-compatible branch in `createLanguageModel`).
const FIRST_PARTY_PROVIDERS = new Set([
  'anthropic',
  'deepseek',
  'mistral',
  'openai',
  'openrouter',
  'ollama',
])

// v7 exposes a provider-agnostic reasoning effort option that each provider
// maps to its native parameter. We only need to translate our `auto` sentinel.
type ReasoningValue =
  'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export type ProviderOptions = {
  languageModel: LanguageModel
  providerOptions?: SharedV3ProviderOptions
  reasoning?: ReasoningValue
  temperature?: number
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
}

export async function getProviderOptions(
  model?: string,
  reasoningEffort?: ReasoningEffort,
  inferenceParameters?: Partial<InferenceParameters>,
  credentials?: ProviderCredentials | null,
  onRequest?: (body: string) => void | Promise<void>,
  fetchOverride?: typeof globalThis.fetch,
): Promise<ProviderOptions> {
  if (!model) {
    error('No model provided')
  }
  if (!credentials?.providerId) {
    error(
      `No provider configured for model "${model}". Please add a provider with this model in Settings → Models.`,
    )
  }

  const providerId = credentials.providerId
  const reasoning = resolveModelReasoning(
    providerId,
    credentials.model?.reasoning,
  )
  const normalizedEffort = normalizeReasoningEffort(reasoningEffort, reasoning)
  const requestFetch = createProviderFetch({
    providerId,
    reasoning,
    reasoningEffort: normalizedEffort,
    extraParameters: credentials.model?.extraParameters,
    extraHeaders: credentials.extraHeaders,
    onRequest,
    fetch: fetchOverride,
  })
  const created = await createLanguageModel(
    providerId,
    model,
    credentials,
    reasoning,
    normalizedEffort,
    requestFetch,
  )

  let result: ProviderOptions = {
    languageModel: await applyReasoningReplayPolicy(created, providerId),
  }
  result = await applyReasoning(result, providerId, model, normalizedEffort)
  result = applyPenalties(result, providerId, inferenceParameters)

  return result
}

async function createLanguageModel(
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
async function createVideoModel({
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

async function createOllamaModel(
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

function getOllamaThink(
  reasoning: ModelReasoning | undefined,
  effort: ReasoningEffort | undefined,
): boolean | ReasoningTier {
  if (reasoning?.type === 'none') return false
  if (reasoning?.type === 'binary') return effort !== 'none'
  if (!effort || effort === 'auto') return true
  return effort === 'none' ? false : effort
}

function toReasoningValue(
  effort: ReasoningEffort | undefined,
): ReasoningValue | undefined {
  if (!effort) return undefined
  if (effort === 'max') return undefined
  if (effort === 'auto') return 'provider-default'
  return effort
}

async function applyReasoning(
  result: ProviderOptions,
  providerId: string,
  modelId: string,
  effort: ReasoningEffort | undefined,
): Promise<ProviderOptions> {
  switch (providerId) {
    case 'openrouter':
      return {
        ...result,
        providerOptions: buildOpenRouterReasoning(effort),
      }
  }

  const reasoning = toReasoningValue(effort)

  // Generic OpenAI-compatible endpoints don't emit structured reasoning. If the
  // model streams inline <think> tags, extract them into reasoning parts.
  if (!FIRST_PARTY_PROVIDERS.has(providerId) && effort && effort !== 'none') {
    const middleware = await buildReasoningMiddleware(providerId, modelId)
    if (middleware) {
      const { wrapLanguageModel } = await import('ai')
      return {
        ...result,
        reasoning,
        languageModel: wrapLanguageModel({
          model: result.languageModel as LanguageModelV3,
          middleware,
        }),
      }
    }
  }

  return { ...result, reasoning }
}

function buildOpenRouterReasoning(
  effort: ReasoningEffort | undefined,
): SharedV3ProviderOptions | undefined {
  if (!effort || effort === 'auto') return undefined
  if (effort === 'max') return undefined
  return { openrouter: { reasoning: { effort } } }
}

async function buildReasoningMiddleware(
  providerId: string,
  modelId: string,
): Promise<LanguageModelMiddleware | undefined> {
  const tag =
    providerReasoningField(providerId) != null
      ? 'reasoning'
      : getReasoningTag(modelId)
  if (!tag) return undefined
  const { extractReasoningMiddleware } = await import('ai')
  return extractReasoningMiddleware({ tagName: tag })
}

type ReasoningPartPolicy = (
  part: LanguageModelV4ReasoningPart,
) => LanguageModelV4ReasoningPart | null

export async function applyReasoningReplayPolicy(
  languageModel: LanguageModel,
  providerId: string,
): Promise<LanguageModel> {
  const policy = getReasoningPartPolicy(providerId)
  if (!policy) return languageModel

  const { wrapLanguageModel } = await import('ai')
  return wrapLanguageModel({
    model: languageModel as LanguageModelV3,
    middleware: {
      specificationVersion: 'v3',
      transformParams: async ({ params }) => ({
        ...params,
        prompt: filterPromptReasoning(params.prompt, policy),
      }),
    },
  })
}

export function getReasoningPartPolicy(
  providerId: string,
): ReasoningPartPolicy | null {
  switch (providerId) {
    case 'openai':
      return keepOpenAIReplayableReasoning
    case 'anthropic':
      return keepAnthropicReplayableReasoning
    case 'deepseek':
    case 'mistral':
    case 'moonshotai':
    case 'alibaba':
    case 'ollama':
    case 'openrouter':
      // These providers fold replayed reasoning into their own format
      return null
    case 'qwen':
    default:
      // Generic OpenAI-compatible endpoints cannot round-trip reasoning
      return () => null
  }
}

export function filterPromptReasoning(
  prompt: LanguageModelV4Prompt,
  policy: ReasoningPartPolicy,
): LanguageModelV4Prompt {
  return prompt.map((message) =>
    message.role === 'assistant'
      ? filterAssistantReasoning(message, policy)
      : message,
  )
}

function filterAssistantReasoning(
  message: Extract<LanguageModelV4Message, { role: 'assistant' }>,
  policy: ReasoningPartPolicy,
): LanguageModelV4Message {
  const content: typeof message.content = []
  for (const part of message.content) {
    if (part.type !== 'reasoning') {
      content.push(part)
      continue
    }
    const kept = policy(part)
    if (kept) content.push(kept)
  }
  return { ...message, content }
}

function keepOpenAIReplayableReasoning(
  part: LanguageModelV4ReasoningPart,
): LanguageModelV4ReasoningPart | null {
  const openai = part.providerOptions?.openai as
    | { itemId?: string | null; reasoningEncryptedContent?: string | null }
    | undefined
  if (typeof openai?.reasoningEncryptedContent === 'string') {
    // Prefer encrypted content over item references, which break once OpenAI
    // no longer stores the original response
    return {
      ...part,
      providerOptions: {
        ...part.providerOptions,
        openai: { reasoningEncryptedContent: openai.reasoningEncryptedContent },
      },
    }
  }
  if (typeof openai?.itemId === 'string') return part
  return null
}

function keepAnthropicReplayableReasoning(
  part: LanguageModelV4ReasoningPart,
): LanguageModelV4ReasoningPart | null {
  const anthropic = part.providerOptions?.anthropic as
    { signature?: unknown; redactedData?: unknown } | undefined
  if (
    typeof anthropic?.signature !== 'string' &&
    typeof anthropic?.redactedData !== 'string'
  ) {
    return null
  }
  return part
}

function applyPenalties(
  result: ProviderOptions,
  providerId: string,
  params: Partial<InferenceParameters> | undefined,
): ProviderOptions {
  if (!params) return result

  const {
    temperature,
    topP,
    frequencyPenalty,
    presencePenalty,
    repeatPenalty,
  } = params

  const penaltyFields = NO_PENALTY_PROVIDERS.has(providerId)
    ? { temperature, topP }
    : { temperature, topP, frequencyPenalty, presencePenalty }

  if (providerId === 'ollama' && repeatPenalty !== undefined) {
    return {
      ...result,
      ...penaltyFields,
      providerOptions: {
        ...result.providerOptions,
        ollama: { repeat_penalty: repeatPenalty },
      },
    }
  }

  return { ...result, ...penaltyFields }
}

function getReasoningTag(modelName: string): string | undefined {
  const lower = modelName.toLowerCase()
  for (const [key, tag] of Object.entries(REASONING_TAGS)) {
    if (lower.includes(key)) {
      return tag
    }
  }
  return undefined
}

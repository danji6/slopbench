import {
  DEFAULT_BINARY_REASONING_PARAMETER,
  defaultModelReasoning,
  normalizeBinaryReasoningParameter,
} from '@sb/core/model-reasoning'
import type { ModelReasoning } from '@sb/core/types'

export type ChatCompletionsTransport = {
  defaultBaseURL?: string
  /** Non-standard field used for reasoning in chat completion responses. */
  reasoningField?: string
}

export type ProviderDefinition = {
  value: string
  label: string
  requiresBaseURL?: boolean
  defaultReasoning: ModelReasoning
  binaryReasoningParameter?: string
  /** Declares that the endpoint accepts OpenAI-style chat completion bodies. */
  chatCompletions?: ChatCompletionsTransport
}

export const KNOWN_PROVIDER_TYPES: ProviderDefinition[] = [
  {
    value: 'anthropic',
    label: 'Anthropic',
    defaultReasoning: defaultModelReasoning(),
  },
  {
    value: 'alibaba',
    label: 'Alibaba',
    defaultReasoning: defaultModelReasoning(),
    chatCompletions: {
      defaultBaseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    },
  },
  {
    value: 'deepseek',
    label: 'DeepSeek',
    defaultReasoning: defaultModelReasoning(),
    chatCompletions: { defaultBaseURL: 'https://api.deepseek.com' },
  },
  {
    value: 'mistral',
    label: 'Mistral',
    defaultReasoning: defaultModelReasoning(),
    chatCompletions: { defaultBaseURL: 'https://api.mistral.ai/v1' },
  },
  {
    value: 'moonshotai',
    label: 'MoonshotAI',
    defaultReasoning: defaultModelReasoning(),
  },
  {
    value: 'ollama',
    label: 'Ollama',
    defaultReasoning: defaultModelReasoning(),
    binaryReasoningParameter: 'think',
  },
  {
    value: 'openai',
    label: 'OpenAI',
    defaultReasoning: defaultModelReasoning(),
    chatCompletions: { defaultBaseURL: 'https://api.openai.com/v1' },
  },
  {
    value: 'openrouter',
    label: 'OpenRouter',
    defaultReasoning: defaultModelReasoning(),
    chatCompletions: {
      defaultBaseURL: 'https://openrouter.ai/api/v1',
    },
  },
  {
    value: 'qwen',
    label: 'QwenCloud',
    requiresBaseURL: true,
    defaultReasoning: {
      type: 'binary',
      parameter: DEFAULT_BINARY_REASONING_PARAMETER,
    },
    binaryReasoningParameter: DEFAULT_BINARY_REASONING_PARAMETER,
    chatCompletions: { reasoningField: 'reasoning_content' },
  },
]

export function getProviderDefinition(providerId: string): ProviderDefinition {
  return (
    KNOWN_PROVIDER_TYPES.find(({ value }) => value === providerId) ?? {
      value: providerId,
      label: providerId,
      requiresBaseURL: true,
      defaultReasoning: defaultModelReasoning(),
      chatCompletions: {},
    }
  )
}

/** Whether a provider needs a user-configured endpoint. */
export function providerRequiresBaseURL(providerId: string): boolean {
  return getProviderDefinition(providerId).requiresBaseURL ?? false
}

/** Non-standard chat response field containing streamed reasoning. */
export function providerReasoningField(providerId: string): string | undefined {
  return getProviderDefinition(providerId).chatCompletions?.reasoningField
}

/** Resolves the base endpoint used by an optimistic video chat request. */
export function resolveChatCompletionsBaseURL(
  providerId: string,
  baseURL?: string,
): string | undefined {
  const transport = getProviderDefinition(providerId).chatCompletions
  if (!transport) return undefined

  const resolved = baseURL || transport.defaultBaseURL
  if (!resolved) return undefined

  return stripEndpointSuffix(resolved, ['/responses', '/chat/completions'])
}

function stripEndpointSuffix(value: string, suffixes: string[]): string {
  const suffix = suffixes.find((candidate) => value.endsWith(candidate))
  return suffix ? value.slice(0, -suffix.length) : value
}

export function resolveModelReasoning(
  providerId: string,
  reasoning?: ModelReasoning,
): ModelReasoning {
  return (
    normalizeConfiguredReasoning(providerId, reasoning) ??
    getProviderDefinition(providerId).defaultReasoning
  )
}

/** Replaces the old generic binary default with a provider's native key. */
export function normalizeConfiguredReasoning(
  providerId: string,
  reasoning?: ModelReasoning,
): ModelReasoning | undefined {
  const parameter = getProviderDefinition(providerId).binaryReasoningParameter
  return normalizeBinaryReasoningParameter(reasoning, parameter)
}

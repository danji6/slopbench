import type {
  LanguageModelV3,
  LanguageModelV4Message,
  LanguageModelV4Prompt,
  LanguageModelV4ReasoningPart,
} from '@ai-sdk/provider'
import type { LanguageModel } from 'ai'

export type ReasoningPartPolicy = (
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

export function filterAssistantReasoning(
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

export function keepOpenAIReplayableReasoning(
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

export function keepAnthropicReplayableReasoning(
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

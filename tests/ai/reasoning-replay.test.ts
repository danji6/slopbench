/// <reference types="bun-types" />
import type {
  LanguageModelV3,
  LanguageModelV4Prompt,
  LanguageModelV4ReasoningPart,
} from '@ai-sdk/provider'
import {
  applyReasoningReplayPolicy,
  filterPromptReasoning,
  getReasoningPartPolicy,
} from '@sb/convex/model/provider/options'
import { describe, expect, test } from 'bun:test'

const bareReasoning: LanguageModelV4ReasoningPart = {
  type: 'reasoning',
  text: 'some chain of thought',
}

const openaiEncryptedReasoning: LanguageModelV4ReasoningPart = {
  type: 'reasoning',
  text: '',
  providerOptions: {
    openai: { itemId: 'rs_1', reasoningEncryptedContent: 'encrypted-blob' },
  },
}

const openaiItemIdOnlyReasoning: LanguageModelV4ReasoningPart = {
  type: 'reasoning',
  text: '',
  providerOptions: { openai: { itemId: 'rs_2' } },
}

const anthropicSignedReasoning: LanguageModelV4ReasoningPart = {
  type: 'reasoning',
  text: 'thinking',
  providerOptions: { anthropic: { signature: 'sig' } },
}

const assistantPrompt = (
  parts: LanguageModelV4ReasoningPart[],
): LanguageModelV4Prompt => [
  { role: 'user', content: [{ type: 'text', text: 'hi' }] },
  {
    role: 'assistant',
    content: [...parts, { type: 'text', text: 'answer' }],
  },
]

const assistantParts = (prompt: LanguageModelV4Prompt) => {
  const message = prompt.find((m) => m.role === 'assistant')
  return message?.role === 'assistant' ? message.content : []
}

describe('reasoning replay policy selection', () => {
  test('round-trips OpenAI and Anthropic through their metadata', () => {
    expect(getReasoningPartPolicy('openai')).toBeFunction()
    expect(getReasoningPartPolicy('anthropic')).toBeFunction()
  })

  test('leaves providers that fold reasoning into their own wire format alone', () => {
    for (const providerId of [
      'deepseek',
      'mistral',
      'moonshotai',
      'alibaba',
      'ollama',
      'openrouter',
    ]) {
      expect(getReasoningPartPolicy(providerId)).toBeNull()
    }
  })

  test('drops all reasoning for qwen and custom endpoints', () => {
    const qwen = getReasoningPartPolicy('qwen')
    const custom = getReasoningPartPolicy('my-openai-compatible')
    expect(qwen?.(openaiEncryptedReasoning)).toBeNull()
    expect(custom?.(anthropicSignedReasoning)).toBeNull()
  })
})

describe('filterPromptReasoning', () => {
  test('openai keeps replayable parts and prefers encrypted content', () => {
    const policy = getReasoningPartPolicy('openai')!
    const prompt = assistantPrompt([
      bareReasoning,
      openaiEncryptedReasoning,
      openaiItemIdOnlyReasoning,
    ])

    const content = assistantParts(filterPromptReasoning(prompt, policy))

    expect(content).toEqual([
      {
        type: 'reasoning',
        text: '',
        providerOptions: {
          openai: { reasoningEncryptedContent: 'encrypted-blob' },
        },
      },
      openaiItemIdOnlyReasoning,
      { type: 'text', text: 'answer' },
    ])
  })

  test('anthropic keeps signed thinking and drops everything else', () => {
    const policy = getReasoningPartPolicy('anthropic')!
    const prompt = assistantPrompt([
      bareReasoning,
      anthropicSignedReasoning,
      openaiEncryptedReasoning,
    ])

    const content = assistantParts(filterPromptReasoning(prompt, policy))

    expect(content).toEqual([
      anthropicSignedReasoning,
      { type: 'text', text: 'answer' },
    ])
  })

  test('qwen drops every reasoning part but keeps other content', () => {
    const policy = getReasoningPartPolicy('qwen')!
    const prompt = assistantPrompt([bareReasoning, openaiEncryptedReasoning])

    const content = assistantParts(filterPromptReasoning(prompt, policy))

    expect(content).toEqual([{ type: 'text', text: 'answer' }])
  })

  test('leaves non-assistant messages untouched', () => {
    const policy = getReasoningPartPolicy('qwen')!
    const prompt = assistantPrompt([bareReasoning])

    const filtered = filterPromptReasoning(prompt, policy)

    expect(filtered[0]).toEqual(prompt[0])
  })
})

function createCapturingModel() {
  const captured: { prompt: LanguageModelV4Prompt }[] = []
  const emptyStream = () =>
    new ReadableStream({
      start(controller) {
        controller.close()
      },
    })

  const model = {
    specificationVersion: 'v3',
    provider: 'test',
    modelId: 'test-model',
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error('not used')
    },
    doStream: async (params: { prompt: LanguageModelV4Prompt }) => {
      captured.push({ prompt: params.prompt })
      return { stream: emptyStream(), request: {}, response: {} }
    },
  } as unknown as LanguageModelV3

  return { model, captured }
}

describe('applyReasoningReplayPolicy', () => {
  test('filters reasoning out of the prompt before it reaches the model', async () => {
    const { model, captured } = createCapturingModel()
    const wrapped = await applyReasoningReplayPolicy(model, 'qwen')

    const prompt = assistantPrompt([bareReasoning])
    await (wrapped as LanguageModelV3).doStream({ prompt } as never)

    expect(assistantParts(captured[0].prompt)).toEqual([
      { type: 'text', text: 'answer' },
    ])
  })

  test('returns the model unchanged when no policy applies', async () => {
    const { model } = createCapturingModel()
    const wrapped = await applyReasoningReplayPolicy(model, 'deepseek')
    expect(wrapped).toBe(model)
  })
})

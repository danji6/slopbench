/// <reference types="bun-types" />
import {
  getProviderDefinition,
  providerReasoningField,
  providerRequiresBaseURL,
  resolveChatCompletionsBaseURL,
  resolveModelReasoning,
} from '@sb/convex/model/provider/known'
import { findModelSelection } from '@sb/convex/model/provider/providers'
import { describe, expect, test } from 'bun:test'

describe('provider definitions', () => {
  test('Qwen provides binary thinking defaults without assuming an endpoint', () => {
    const qwen = getProviderDefinition('qwen')
    expect(qwen.chatCompletions).toEqual({
      reasoningField: 'reasoning_content',
    })
    expect(qwen.defaultReasoning).toEqual({
      type: 'binary',
      parameter: 'enable_thinking',
    })
  })

  test('Qwen declares its extended reasoning response field', () => {
    expect(providerReasoningField('qwen')).toBe('reasoning_content')
    expect(providerReasoningField('openai')).toBeUndefined()
    expect(providerReasoningField('custom')).toBeUndefined()
  })

  test('Qwen requires a configured endpoint for chat completions', () => {
    expect(providerRequiresBaseURL('qwen')).toBe(true)
    expect(providerRequiresBaseURL('custom')).toBe(true)
    expect(providerRequiresBaseURL('openai')).toBe(false)
    expect(resolveChatCompletionsBaseURL('qwen')).toBeUndefined()
    expect(
      resolveChatCompletionsBaseURL('qwen', 'https://qwen.example/v1'),
    ).toBe('https://qwen.example/v1')
  })

  test('custom providers retain the legacy effort ladder', () => {
    expect(getProviderDefinition('custom').chatCompletions).toEqual({})
    expect(resolveModelReasoning('custom')).toEqual({
      type: 'effort',
      efforts: ['low', 'medium', 'high'],
    })
  })

  test('resolves chat completion transports without changing form defaults', () => {
    expect(resolveChatCompletionsBaseURL('openrouter')).toBe(
      'https://openrouter.ai/api/v1',
    )
    expect(
      resolveChatCompletionsBaseURL(
        'custom',
        'https://example.com/v1/responses',
      ),
    ).toBe('https://example.com/v1')
    expect(resolveChatCompletionsBaseURL('anthropic')).toBeUndefined()
    expect(resolveChatCompletionsBaseURL('openai')).toBe(
      'https://api.openai.com/v1',
    )
  })

  test('Ollama exposes its native binary reasoning parameter', () => {
    expect(getProviderDefinition('ollama').binaryReasoningParameter).toBe(
      'think',
    )
    expect(
      resolveModelReasoning('ollama', {
        type: 'binary',
        parameter: 'enable_thinking',
      }),
    ).toEqual({ type: 'binary', parameter: 'think' })
    expect(
      resolveModelReasoning('ollama', {
        type: 'binary',
        parameter: 'custom_thinking_key',
      }),
    ).toEqual({ type: 'binary', parameter: 'custom_thinking_key' })
  })

  test('explicit model reasoning overrides provider defaults', () => {
    expect(
      resolveModelReasoning('qwen', {
        type: 'effort',
        efforts: ['high', 'xhigh', 'max'],
      }),
    ).toEqual({
      type: 'effort',
      efforts: ['high', 'xhigh', 'max'],
    })
  })

  test('resolved Qwen model metadata carries binary reasoning', () => {
    expect(
      findModelSelection(
        [
          {
            id: 'qwen',
            enabled: true,
            models: [{ id: 'qwen3.8-max' }],
          },
        ],
        'qwen3.8-max',
      )?.reasoning,
    ).toEqual({ type: 'binary', parameter: 'enable_thinking' })
  })

  test('session model metadata excludes provider inference configuration', () => {
    expect(
      findModelSelection(
        [
          {
            id: 'openai',
            enabled: true,
            models: [
              { id: 'model', inference: { temperature: 0.3, topP: 0.7 } },
            ],
          },
        ],
        'model',
      ),
    ).toEqual({
      id: 'model',
      label: undefined,
      contextWindow: undefined,
      reasoning: {
        type: 'effort',
        efforts: ['low', 'medium', 'high'],
      },
      extraParameters: undefined,
    })
  })
})

/// <reference types="bun-types" />
import { evaluate } from '@sb/core/interpreter/evaluate'
import { describe, expect, test } from 'bun:test'

const context = { modelId: 'model-a', modelName: 'Model A' }

describe('model variables in dynamic blocks', () => {
  test('interpolates both variables inline', () => {
    expect(evaluate('{{ modelName }} ({{ modelId }})', context)).toBe(
      'Model A (model-a)',
    )
  })

  test('exposes both variables inside eval blocks', () => {
    const text = [
      '#eval',
      "if (modelId === 'model-a') {",
      '  return modelName.toUpperCase()',
      '}',
      '#end',
    ].join('\n')
    expect(evaluate(text, context)).toBe('MODEL A')
  })

  test('selects conditional branches using the ID or name', () => {
    const text = [
      "#if modelId === 'model-a'",
      'Instructions for A.',
      "#elif modelName === 'Model B'",
      'Instructions for B.',
      '#else',
      'Default instructions.',
      '#endif',
    ].join('\n')
    expect(evaluate(text, context)).toBe('Instructions for A.')
    expect(evaluate(text, { modelId: 'model-b', modelName: 'Model B' })).toBe(
      'Instructions for B.',
    )
    expect(evaluate(text)).toBe('Default instructions.')
  })

  test('defines missing model variables as undefined', () => {
    expect(evaluate('{{ modelId }}{{ modelName }}')).toBe('')
    expect(
      evaluate('{{ modelId === undefined && modelName === undefined }}'),
    ).toBe('true')
  })
})

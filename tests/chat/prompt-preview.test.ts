/// <reference types="bun-types" />
import { evaluatePromptPreview } from '@/lib/chat/prompts'
import type { EvalContext } from '@sb/core/interpreter/types'
import { describe, expect, test } from 'bun:test'

const context: EvalContext = {
  assistant: 'Fable',
  user: 'Alice',
  owner: 'Bob',
  tools: ['web_search'],
  isAdmin: false,
  userCount: 2,
  agentCount: 3,
}

describe('evaluatePromptPreview', () => {
  test('passes through content without interpolation untouched', () => {
    const content = 'Hello there.  \n\nTrailing space kept.   '
    expect(evaluatePromptPreview(content, context)).toBe(content)
  })

  test('resolves inline identity expressions', () => {
    expect(
      evaluatePromptPreview('Hi {{ user }}, I am {{ assistant }}.', context),
    ).toBe('Hi Alice, I am Fable.')
    // `char`/`ai` are aliases of the agent name.
    expect(evaluatePromptPreview('{{ char }}', context)).toBe('Fable')
    expect(evaluatePromptPreview('{{ ai }}', context)).toBe('Fable')
    // `owner` is the agent owner's name, distinct from the invoking user.
    expect(evaluatePromptPreview('{{ owner }}', context)).toBe('Bob')
  })

  test('resolves participant counts', () => {
    expect(
      evaluatePromptPreview(
        '{{ userCount }} users, {{ agentCount }} agents',
        context,
      ),
    ).toBe('2 users, 3 agents')
    // Unset counts default to 0.
    expect(evaluatePromptPreview('{{ userCount }}', {})).toBe('0')
  })

  test('treats $get/$set as no-ops without throwing', () => {
    const out = evaluatePromptPreview(
      'before\n$```\n$set("x", 1)\nreturn $get("x")\n```\nafter',
      context,
    )
    // $get reads from the throwaway store seeded within the same evaluation.
    expect(out).toContain('before')
    expect(out).toContain('after')
  })

  test('renders an unknown $get as empty', () => {
    expect(evaluatePromptPreview('value:{{ $get("missing") }}', context)).toBe(
      'value:',
    )
  })
})

/// <reference types="bun-types" />
import { evaluatePromptPreview as preview } from '@/lib/chat/prompts'
import { evaluateRequest } from '@sb/core/interpreter/request'
import type { EvalContext } from '@sb/core/interpreter/types'
import { describe, expect, test } from 'bun:test'

const evaluatePromptPreview = (text: string, context: EvalContext) =>
  preview(text, context, (request) => evaluateRequest(request))

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
  test('passes through content without interpolation untouched', async () => {
    const content = 'Hello there.  \n\nTrailing space kept.   '
    expect(await evaluatePromptPreview(content, context)).toBe(content)
  })

  test('resolves inline identity expressions', async () => {
    expect(
      await evaluatePromptPreview(
        'Hi {{ user }}, I am {{ assistant }}.',
        context,
      ),
    ).toBe('Hi Alice, I am Fable.')
    // `char`/`ai` are aliases of the agent name.
    expect(await evaluatePromptPreview('{{ char }}', context)).toBe('Fable')
    expect(await evaluatePromptPreview('{{ ai }}', context)).toBe('Fable')
    // `owner` is the agent owner's name, distinct from the invoking user.
    expect(await evaluatePromptPreview('{{ owner }}', context)).toBe('Bob')
  })

  test('resolves participant counts', async () => {
    expect(
      await evaluatePromptPreview(
        '{{ userCount }} users, {{ agentCount }} agents',
        context,
      ),
    ).toBe('2 users, 3 agents')
    // Unset counts default to 0.
    expect(await evaluatePromptPreview('{{ userCount }}', {})).toBe('0')
  })

  test('treats getVar/setVar as no-ops without throwing', async () => {
    const out = await evaluatePromptPreview(
      'before\n#eval\nsetVar("x", 1)\nreturn getVar("x")\n#end\nafter',
      context,
    )
    // getVar reads from the throwaway store seeded within the same evaluation.
    expect(out).toContain('before')
    expect(out).toContain('after')
  })

  test('renders an unknown getVar as empty', async () => {
    expect(
      await evaluatePromptPreview('value:{{ getVar("missing") }}', context),
    ).toBe('value:')
  })
})

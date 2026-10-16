import {
  collectCompletions,
  staticCompletions,
} from '@sb/core/code-completion/engine'
import { javascriptCompletions } from '@sb/core/code-completion/javascript'
import type {
  Completion,
  CompletionProvider,
  CompletionRequest,
} from '@sb/core/code-completion/types'
import { describe, expect, test } from 'bun:test'

const symbols: Completion[] = [
  { label: 'text', kind: 'variable' },
  { label: 'message', kind: 'variable' },
  {
    label: 'replace',
    kind: 'function',
    snippet: 'replace($0)',
    params: [
      {
        name: 'scope',
        values: ['selection', 'paragraph', 'message', 'toEnd', 'toStart'],
      },
      { name: 'value', optional: true, description: 'Replacement text' },
    ],
  },
]

function request(
  source: string,
  trigger: CompletionRequest['trigger'] = 'explicit',
): CompletionRequest {
  const offset = source.indexOf('▌')
  expect(offset).toBeGreaterThanOrEqual(0)
  return {
    text: source.replace('▌', ''),
    offset,
    language: 'javascript',
    trigger,
  }
}

async function complete(
  source: string,
  trigger?: CompletionRequest['trigger'],
) {
  return await javascriptCompletions(symbols)(request(source, trigger))
}

async function labels(source: string, trigger?: CompletionRequest['trigger']) {
  return (await complete(source, trigger)).items.map((item) => item.label)
}

async function insert(source: string, label: string) {
  const input = request(source)
  const item = (await complete(source)).items.find(
    (item) => item.label === label,
  )
  expect(item).toBeDefined()
  return (
    input.text.slice(0, item!.from) +
    (item!.insertText ?? item!.label) +
    input.text.slice(item!.to)
  )
}

describe('JavaScript lexical completions', () => {
  test('combines globals with variables, classes and functions, including later declarations', async () => {
    expect(
      await labels(
        'const local = 1; ▌; let later; function helper(){}; class Thing {}',
      ),
    ).toEqual(
      expect.arrayContaining([
        'text',
        'message',
        'replace',
        'local',
        'later',
        'helper',
        'Thing',
      ]),
    )
  })

  test('respects nested block scope and var function scope', async () => {
    const result = await labels('const outer = 1; { let inner; var shared; } ▌')
    expect(result).toContain('outer')
    expect(result).toContain('shared')
    expect(result).not.toContain('inner')
  })

  test('does not leak function parameters or local variables', async () => {
    const result = await labels('function f(secret){ let hidden; } ▌')
    expect(result).not.toContain('secret')
    expect(result).not.toContain('hidden')
  })

  test('includes destructuring, rest parameters and catch bindings', async () => {
    const result = await labels(
      'function f({a: renamed, nested: [first]}, ...rest) { try {} catch ({message: reason}) { ▌ } }',
    )
    expect(result).toEqual(
      expect.arrayContaining(['renamed', 'first', 'rest', 'reason']),
    )
    expect(result).not.toContain('nested')
    expect(result).not.toContain('a')
  })

  test('keeps loop bindings and arrow parameters inside their scopes', async () => {
    expect(await labels('for (let item of []) { ▌ }')).toContain('item')
    expect(await labels('for (let item of []) {} ▌')).not.toContain('item')
    expect(await labels('for (let item of []) item; ▌')).not.toContain('item')
    expect(await labels('const f = (param) => param; ▌')).not.toContain('param')
    expect(await labels('const f = (param) => (▌)')).toContain('param')
    expect(await labels('class T { static { var hidden; } } ▌')).not.toContain(
      'hidden',
    )
  })

  test('inner binding shadows host function metadata', async () => {
    const result = await complete('const replace = () => {}; replace(▌)')
    expect(result.signature).toBeUndefined()
    expect(result.items.some((item) => item.kind === 'value')).toBe(false)
    const names = (await complete('const replace = 1; rep▌')).items
    expect(names).toHaveLength(1)
    expect(names[0]?.snippet).toBeUndefined()
  })

  test('handles unfinished declarations and missing closing braces', async () => {
    expect(
      await labels('function f(param) { const local = 1; lo▌', 'typing'),
    ).toContain('local')
    expect(await labels('function f(param) { pa▌', 'typing')).toContain('param')
    expect(await labels('const x = ; ▌')).not.toContain('✖')
  })

  for (const source of [
    '// te▌',
    '/* te▌ */',
    "const a = 'te▌'",
    "const a = 'te▌",
    'const re = /te▌/',
    'const re = /te▌',
    'const template = `te▌`',
    'const template = `te▌',
    'const te▌ = 1',
    'function te▌() {}',
    'const x = text.te▌',
    'const x = text.▌',
    'const x = { te▌: 1 }',
  ]) {
    test(`suppresses identifiers in ${source}`, async () => {
      expect(await labels(source)).toEqual([])
    })
  }

  test('supports identifiers inside template expressions and computed properties', async () => {
    expect(await labels('const x = `hello ${te▌}`')).toContain('text')
    expect(await labels('const x = object[te▌]')).toContain('text')
  })

  test('replaces the complete identifier and preserves literal dollar signs', async () => {
    expect(await insert('const $local = 1; $lo▌cal', '$local')).toBe(
      'const $local = 1; $local',
    )
    expect(await insert('te▌xt', 'text')).toBe('text')
  })

  test('does not insert duplicate call parentheses', async () => {
    const result = await complete('rep▌lace()')
    expect(
      result.items.find((item) => item.label === 'replace')?.snippet,
    ).toBeUndefined()
  })

  test('supports Unicode identifiers including astral characters', async () => {
    expect(await insert('const 𐐀name = 1; 𐐀n▌ame', '𐐀name')).toBe(
      'const 𐐀name = 1; 𐐀name',
    )
  })
})

describe('argument values and signature hints', () => {
  test('supports mixed string choices and literal JavaScript choices', async () => {
    const provider = javascriptCompletions([
      {
        label: 'choose',
        params: [
          {
            name: 'value',
            values: ['text', { label: 'false', insertText: 'false' }],
          },
        ],
      },
    ])
    const result = await provider(request('choose(▌)'))
    expect(result.items.map((item) => item.insertText)).toEqual([
      "'text'",
      'false',
    ])
    const quoted = await provider(request("choose('▌')"))
    expect(quoted.items.map((item) => item.label)).toEqual(['text'])
  })

  test('suggests every scope on an empty argument or opening quote', async () => {
    for (const source of ['replace(▌)', "replace('▌')", 'replace(▌']) {
      expect(await labels(source, 'triggerCharacter')).toEqual([
        'selection',
        'paragraph',
        'message',
        'toEnd',
        'toStart',
      ])
    }
  })

  test('preserves quote style, suffixes and closers', async () => {
    expect(await insert("replace('pa▌')", 'paragraph')).toBe(
      "replace('paragraph')",
    )
    expect(await insert('replace("pa▌graph")', 'paragraph')).toBe(
      'replace("paragraph")',
    )
    expect(await insert("replace('pa▌", 'paragraph')).toBe(
      "replace('paragraph'",
    )
    expect(await insert('replace(pa▌)', 'paragraph')).toBe(
      "replace('paragraph')",
    )
    expect(await insert("replace('pa▌', value)", 'paragraph')).toBe(
      "replace('paragraph', value)",
    )
  })

  test('ignores commas nested in arguments and highlights the next parameter', async () => {
    for (const source of [
      'replace(fn(1, 2), ▌)',
      'replace({ a: [1, 2] }, ▌)',
      'replace(`x,${fn(1, 2)}`, ▌)',
      "replace('a,b', ▌)",
      'replace(/a,b/, ▌)',
    ]) {
      expect((await complete(source)).signature?.activeParameter).toBe(1)
    }
  })

  test('uses the innermost call and ends help after its closing parenthesis', async () => {
    expect(
      (await complete('replace(replace(▌), value)')).signature?.activeParameter,
    ).toBe(0)
    expect(
      (await complete('replace(other(▌), value)')).signature,
    ).toBeUndefined()
    expect((await complete('replace()▌')).signature).toBeUndefined()
  })

  test('shows only signatures on cursor movement', async () => {
    const result = await complete("replace('message', ▌text)", 'selection')
    expect(result.signature?.activeParameter).toBe(1)
    expect(result.items).toEqual([])
  })

  test('does not offer literal values inside complex expressions or comments', async () => {
    expect((await complete("replace('x' + 'pa▌')")).items).toEqual([])
    expect((await complete('replace(/* pa▌ */)')).items).toEqual([])
  })

  test('allows local expressions when no fixed argument value matches', async () => {
    expect(
      await labels('const targetScope = "message"; replace(targetS▌)'),
    ).toContain('targetScope')
  })
})

describe('provider composition', () => {
  test('prioritizes exact and prefix matches and deduplicates identical edits', async () => {
    const source = staticCompletions([
      { label: 'textOther' },
      { label: 'text' },
      { label: 'teapot' },
    ])
    const result = await collectCompletions([source, source], request('te▌'))
    expect(result.items).toHaveLength(3)
    expect((await source(request('text▌'))).items[0]?.label).toBe('text')
  })

  test('isolates synchronous and async failures and excludes invalid ranges', async () => {
    const failed: CompletionProvider = () => {
      throw new Error('failed')
    }
    const rejected: CompletionProvider = async () => {
      throw new Error('rejected')
    }
    const invalid: CompletionProvider = () => ({
      items: [{ label: 'bad', from: -1, to: 2 }],
    })
    const source = staticCompletions([{ label: 'text' }])
    const result = await collectCompletions(
      [failed, rejected, invalid, source],
      request('te▌'),
    )
    expect(result.items.map((item) => item.label)).toEqual(['text'])
  })

  test('manual empty-prefix requests work and non-JavaScript analysis is disabled', async () => {
    const source = staticCompletions([{ label: 'text' }])
    expect((await source(request('▌', 'explicit'))).items).toHaveLength(1)
    expect((await source(request('▌', 'typing'))).items).toHaveLength(0)
    expect(
      await javascriptCompletions(symbols)({
        ...request('te▌'),
        language: 'css',
      }),
    ).toEqual({ items: [] })
  })
})

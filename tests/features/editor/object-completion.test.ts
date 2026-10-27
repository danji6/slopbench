import { javascriptCompletions } from '@sb/core/code-completion/javascript'
import type {
  Completion,
  CompletionRequest,
} from '@sb/core/code-completion/types'
import { describe, expect, test } from 'bun:test'

const scope = { name: 'scope', values: ['workspace', 'agent'] }
const symbols: Completion[] = [
  {
    label: 'read',
    params: [
      { name: 'path' },
      {
        name: 'options',
        properties: [
          {
            name: 'wrap',
            description: 'Wrap content',
            values: [
              { label: 'true', insertText: 'true' },
              { label: 'false', insertText: 'false' },
            ],
          },
          scope,
          {
            name: 'nested',
            properties: [scope, { name: 'deeper', properties: [scope] }],
          },
          { name: 'dash-key', values: ['value'] },
        ],
      },
    ],
  },
]

function request(
  source: string,
  trigger: CompletionRequest['trigger'] = 'explicit',
): CompletionRequest {
  return {
    text: source.replace('▌', ''),
    offset: source.indexOf('▌'),
    language: 'javascript',
    trigger,
  }
}

const complete = (source: string, trigger?: CompletionRequest['trigger']) =>
  javascriptCompletions(symbols)(request(source, trigger))

async function labels(source: string) {
  return (await complete(source)).items.map((item) => item.label)
}

async function insert(source: string, label: string) {
  const input = request(source)
  const item = (await complete(source)).items.find(
    (entry) => entry.label === label,
  )!
  expect(item).toBeDefined()
  return (
    input.text.slice(0, item.from) + item.insertText + input.text.slice(item.to)
  )
}

describe('inline object argument completion', () => {
  test('offers a literal object starter with a caret inside', async () => {
    const result = await complete("read('note', ▌)")
    expect(result.items).toMatchObject([
      { label: '{}', insertText: '{}', caretOffset: 1, retrigger: true },
    ])
  })

  test.each([
    "read('note', { ▌ })",
    "read('note', { ▌",
    "read('note', {\n ▌\n})",
    "read('note', { /* comment */ ▌ })",
  ])(
    'offers fields inside empty and unfinished objects: %s',
    async (source) => {
      expect(await labels(source)).toEqual([
        'wrap',
        'scope',
        'nested',
        'dash-key',
      ])
    },
  )

  test('replaces complete key suffixes and leaves surrounding whitespace alone', async () => {
    expect(await insert("read('note', { wr▌ap\n})", 'wrap')).toBe(
      "read('note', { wrap: \n})",
    )
    expect(await insert("read('note', { 'sc▌ope': 'agent' })", 'scope')).toBe(
      "read('note', { 'scope': 'agent' })",
    )
    expect(await insert('read("note", { "sc▌ope": "agent" })', 'scope')).toBe(
      'read("note", { "scope": "agent" })',
    )
    expect(await insert("read('note', { wr▌ap:true })", 'wrap')).toBe(
      "read('note', { wrap:true })",
    )
    expect(await insert("read('note', { dash▌ })", 'dash-key')).toBe(
      "read('note', { 'dash-key':  })",
    )
  })

  test('suggests values and describes the current field', async () => {
    const result = await complete("read('note', { wrap: ▌ })")
    expect(result.items.map((item) => item.label)).toEqual(['true', 'false'])
    expect(result.signature?.activePropertyPath).toEqual(['wrap'])
    expect(await insert("read('note', { wrap: fa▌lse })", 'false')).toBe(
      "read('note', { wrap: false })",
    )
    expect(await insert("read('note', { scope: 'a▌gent' })", 'agent')).toBe(
      "read('note', { scope: 'agent' })",
    )
  })

  test('recovers unfinished quoted keys and values at the end of the source', async () => {
    expect(await insert('read("note", { "sc▌', 'scope')).toBe(
      'read("note", { "scope": ',
    )
    expect(await insert("read('note', { /* lead */ 'sc▌", 'scope')).toBe(
      "read('note', { /* lead */ 'scope': ",
    )
    expect(await insert('read("note", { scope: "a▌', 'agent')).toBe(
      'read("note", { scope: "agent"',
    )
  })

  test('excludes sibling keys before and after the caret but permits editing the current key', async () => {
    expect(
      await labels("read('note', { wrap: true, ▌, scope: 'agent' })"),
    ).toEqual(['nested', 'dash-key'])
    expect(
      await labels("read('note', { wr▌ap: true, scope: 'agent' })"),
    ).toEqual(['wrap'])
    expect(await labels("read('note', { wrap, ▌ })")).not.toContain('wrap')
  })

  test('recurses into object fields without mixing sibling metadata', async () => {
    expect(
      await labels("read('note', { nested: { ▌ }, scope: 'agent' })"),
    ).toEqual(['scope', 'deeper'])
    expect(
      await labels("read('note', { nested: { deeper: { scope: ▌ } } })"),
    ).toEqual(['workspace', 'agent'])
    expect(
      (await complete("read('note', { nested: { deeper: { scope: ▌ } } })"))
        .signature?.activePropertyPath,
    ).toEqual(['nested', 'deeper', 'scope'])
    expect(await labels("read('note', { nested: ▌ })")).toEqual(['{}'])
    expect(await labels("read('note', { nested: { deeper: { sc▌")).toEqual([
      'scope',
    ])
  })

  test('ignores commas in expressions, strings, arrays, and nested objects', async () => {
    expect(
      await labels("read('note', { wrap: fn(1, 2), scope: ['a', 'b'], ▌ })"),
    ).toEqual(['nested', 'dash-key'])
    expect(
      await labels(
        "read('note', { scope: 'a,b', nested: { scope: 'agent' }, ▌ })",
      ),
    ).toEqual(['wrap', 'dash-key'])
  })

  test.each([
    "read('note', { // wr▌\n })",
    "read('note', { /* wr▌ */ })",
    "read('note', { ...wr▌ })",
    "read('note', { [wr▌]: true })",
    "read('note', { scope: `wr▌` })",
    "read('note', { scope: /wr▌/ })",
  ])(
    'does not treat unsupported syntax as a metadata key or value: %s',
    async (source) => {
      expect(await labels(source)).toEqual([])
    },
  )

  test('preserves local completion in expressions without inferring local option objects', async () => {
    for (const expression of [
      '{ ...lo▌ }',
      '{ [lo▌]: true }',
      '{ wrap: { value: lo▌ } }',
      '{ wrap: true } || lo▌',
    ]) {
      expect(
        await labels(`const local = true; read('note', ${expression})`),
      ).toContain('local')
    }
    expect(
      await labels("const local = true; read('note', { wrap: lo▌ })"),
    ).toContain('local')
    expect(
      await labels("const local = true; read('note', { wrap: !lo▌ })"),
    ).toContain('local')
    expect(await labels("const options = {}; read('note', opt▌)")).toContain(
      'options',
    )
    expect(
      await labels("const options = { wr▌ }; read('note', options)"),
    ).not.toContain('wrap')
    expect(
      (await complete("const read = () => {}; read('note', { wr▌ })"))
        .signature,
    ).toBeUndefined()
  })

  test('retains field hints on selection without opening suggestions', async () => {
    const result = await complete(
      "read('note', { nested: { scope: ▌ } })",
      'selection',
    )
    expect(result.items).toEqual([])
    expect(result.signature?.activePropertyPath).toEqual(['nested', 'scope'])
  })
})

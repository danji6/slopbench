import {
  type SessionSearchClause,
  type SessionSearchTarget,
  matchesSessionSearch,
} from '@sb/core/session-search/filters'
import { parseSessionSearch } from '@sb/core/session-search/parse'
import { describe, expect, test } from 'bun:test'

describe('session search parsing', () => {
  test.each<[string, string, SessionSearchClause[]]>([
    ['', '', []],
    ['  bug   fix  ', 'bug   fix', []],
    ['folder:Project', '', [{ key: 'folder', values: ['Project'] }]],
    ['AGENT:Alice', '', [{ key: 'agent', values: ['Alice'] }]],
    ['user:Jane', '', [{ key: 'user', values: ['Jane'] }]],
    ['participant:Alice', '', [{ key: 'participant', values: ['Alice'] }]],
    ['agent:Alice,Bob', '', [{ key: 'agent', values: ['Alice', 'Bob'] }]],
    ['agent:Alice , Bob', '', [{ key: 'agent', values: ['Alice', 'Bob'] }]],
    ['agent:,,Alice,,', '', [{ key: 'agent', values: ['Alice'] }]],
    ['agent:"  Alice  "', '', [{ key: 'agent', values: ['Alice'] }]],
    [
      'agent:Code,"Codebase Explorer"',
      '',
      [{ key: 'agent', values: ['Code', 'Codebase Explorer'] }],
    ],
    [
      'agent:"Code,Codebase Explorer"',
      '',
      [{ key: 'agent', values: ['Code,Codebase Explorer'] }],
    ],
    [
      'agent:Code\\,Explorer',
      '',
      [{ key: 'agent', values: ['Code,Explorer'] }],
    ],
    [
      'agent:"Alice \\"The Architect\\""',
      '',
      [{ key: 'agent', values: ['Alice "The Architect"'] }],
    ],
    ['agent:"C:\\\\Code"', '', [{ key: 'agent', values: ['C:\\Code'] }]],
    ['agent:C:\\Code', '', [{ key: 'agent', values: ['C:\\Code'] }]],
    ['agent:Alice\\', '', [{ key: 'agent', values: ['Alice\\'] }]],
    [
      'agent:"Codebase Explorer',
      '',
      [{ key: 'agent', values: ['Codebase Explorer'] }],
    ],
    [
      'agent:"Code user:Jane',
      '',
      [{ key: 'agent', values: ['Code user:Jane'] }],
    ],
    ['agent:', '', []],
    ['agent:""', '', []],
    ['agent: Alice', 'Alice', []],
    ['agent: user:Jane', '', [{ key: 'user', values: ['Jane'] }]],
    ['unknown:Alice,Jane', 'unknown:Alice,Jane', []],
    ['someagent:Alice', 'someagent:Alice', []],
    ['x-agent:Alice', 'x-agent:Alice', []],
    ['"agent:Alice"', '"agent:Alice"', []],
    ['bug,fix agent:Alice', 'bug,fix', [{ key: 'agent', values: ['Alice'] }]],
    ['bug agent:Alice fix', 'bug fix', [{ key: 'agent', values: ['Alice'] }]],
    [
      'bug fix\nagent:Alice\tuser:Jane',
      'bug fix',
      [
        { key: 'agent', values: ['Alice'] },
        { key: 'user', values: ['Jane'] },
      ],
    ],
    [
      'agent:Alice agent:Bob',
      '',
      [
        { key: 'agent', values: ['Alice'] },
        { key: 'agent', values: ['Bob'] },
      ],
    ],
  ])('parses %j', (input, text, clauses) => {
    expect(parseSessionSearch(input)).toEqual({ text, clauses })
  })

  test('accepts arbitrary live input without throwing or getting stuck', () => {
    const input =
      'title folder:"a,b" agent:"Code \\"user:Jane\\"",Bob user:,,Jane'
    for (let end = 0; end <= input.length; end++) {
      expect(() => parseSessionSearch(input.slice(0, end))).not.toThrow()
    }
  })
})

describe('session search matching', () => {
  const target: SessionSearchTarget = {
    folderNames: ['MyProject', 'Design'],
    participants: [
      { kind: 'agent', name: 'Alice "The Architect"' },
      { kind: 'agent', name: 'Code,Codebase Explorer' },
      { kind: 'user', name: 'Jane' },
      { kind: 'user', name: 'Bob' },
    ],
  }
  const matches = (input: string) =>
    matchesSessionSearch(parseSessionSearch(input).clauses, target)

  test('matches case-insensitive substrings and any ancestor folder name', () => {
    expect(matches('folder:project agent:ARCHITECT user:jan')).toBe(true)
    expect(matches('folder:design')).toBe(true)
    expect(matches('folder:missing')).toBe(false)
  })

  test('requires all clauses and allows alternative values', () => {
    expect(matches('agent:Missing,Alice user:Jane')).toBe(true)
    expect(matches('agent:Alice agent:Explorer')).toBe(true)
    expect(matches('agent:Alice agent:Missing')).toBe(false)
    expect(matches('folder:Project folder:Design')).toBe(true)
  })

  test('keeps participant kinds distinct and supports their union', () => {
    expect(matches('agent:Bob')).toBe(false)
    expect(matches('user:Alice')).toBe(false)
    expect(matches('participant:Alice participant:Bob')).toBe(true)
    expect(matches('participant:Missing')).toBe(false)
  })

  test('matches literal quotes and commas in names', () => {
    expect(matches('agent:"Alice \\"The Architect\\""')).toBe(true)
    expect(matches('agent:"Code,Codebase Explorer"')).toBe(true)
    expect(matches('agent:"Code,Missing"')).toBe(false)
  })

  test('empty clauses are unrestricted and missing metadata cannot match', () => {
    expect(
      matchesSessionSearch([], { folderNames: [], participants: [] }),
    ).toBe(true)
    const clauses: SessionSearchClause[] = [
      { key: 'folder', values: ['Project'] },
    ]
    expect(
      matchesSessionSearch(clauses, { folderNames: [], participants: [] }),
    ).toBe(false)
  })
})

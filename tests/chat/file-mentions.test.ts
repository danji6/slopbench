/// <reference types="bun-types" />
import { filterMentions } from '@/lib/chat/file-mentions'
import {
  findMentions,
  getActiveMention,
  mentionToken,
  normalizeMentionPath,
  parseFileMentions,
} from '@sb/core/mentions/parse'
import { describe, expect, test } from 'bun:test'

describe('parseFileMentions', () => {
  test('extracts file-like mentions', () => {
    expect(parseFileMentions('look at @src/foo.ts please')).toEqual([
      'src/foo.ts',
    ])
  })

  test('detects extension-only mentions without a slash', () => {
    expect(parseFileMentions('check @readme.md')).toEqual(['readme.md'])
  })

  test('extracts quoted mentions with spaces in filenames', () => {
    expect(
      parseFileMentions(
        'link @"magic number.txt" and tell me what number you received',
      ),
    ).toEqual(['magic number.txt'])
  })

  test('takes a quoted path verbatim without a file-like heuristic', () => {
    expect(parseFileMentions('open @"my notes"')).toEqual(['my notes'])
  })

  test('does not over-capture an unquoted spaced path', () => {
    // Without quotes a mention ends at the first space, so the spaced phrase is
    // never captured and the bare `@magic` token isn't file-like.
    expect(parseFileMentions('link @magic number.txt')).toEqual([])
  })

  test('keeps punctuation after a closing quote out of the path', () => {
    expect(parseFileMentions('see @"magic number.txt", then reply')).toEqual([
      'magic number.txt',
    ])
  })

  test('ignores non-file-like tokens', () => {
    expect(parseFileMentions('hey @media and @someone')).toEqual([])
  })

  // A no-extension token followed by prose no longer over-captures: the bare
  // mention ends at the first space and `@config` isn't file-like.
  test('does not over-capture prose following a non-file-like token', () => {
    expect(parseFileMentions('@config and run main.go')).toEqual([])
  })

  test('respects the backslash escape', () => {
    expect(parseFileMentions('literal \\@src/foo.ts here')).toEqual([])
  })

  test('strips trailing punctuation', () => {
    expect(parseFileMentions('see @src/foo.ts, then @b/c.js.')).toEqual([
      'src/foo.ts',
      'b/c.js',
    ])
  })

  test('dedupes repeated mentions', () => {
    expect(parseFileMentions('@a/b.ts and again @a/b.ts')).toEqual(['a/b.ts'])
  })
})

describe('normalizeMentionPath', () => {
  test('keeps slashed paths', () => {
    expect(normalizeMentionPath('src/a')).toBe('src/a')
  })

  test('rejects bare words', () => {
    expect(normalizeMentionPath('media')).toBeNull()
  })
})

describe('getActiveMention', () => {
  test('returns the token under the caret', () => {
    const text = 'edit @src/fo'
    expect(getActiveMention(text, text.length)).toEqual({
      query: 'src/fo',
      start: 5,
      end: text.length,
    })
  })

  test('opens with no file-like heuristic so the picker shows early', () => {
    const text = 'hey @m'
    expect(getActiveMention(text, text.length)?.query).toBe('m')
  })

  test('is null after whitespace ends the token', () => {
    const text = '@src/foo.ts '
    expect(getActiveMention(text, text.length)).toBeNull()
  })

  test('is null for an escaped mention', () => {
    const text = 'x \\@src/foo'
    expect(getActiveMention(text, text.length)).toBeNull()
  })

  test('keeps the query open across spaces inside an unclosed quote', () => {
    const text = 'edit @"magic num'
    expect(getActiveMention(text, text.length)).toEqual({
      query: 'magic num',
      start: 5,
      end: text.length,
    })
  })

  test('is null once the quote is closed', () => {
    const text = '@"magic number.txt"'
    expect(getActiveMention(text, text.length)).toBeNull()
  })
})

describe('mentionToken', () => {
  test('leaves space-free paths unquoted', () => {
    expect(mentionToken('src/foo.ts')).toBe('@src/foo.ts')
  })

  test('quotes paths containing spaces', () => {
    expect(mentionToken('magic number.txt')).toBe('@"magic number.txt"')
  })
})

describe('findMentions', () => {
  test('reports spans that cover the mention but not trailing prose', () => {
    expect(findMentions('see @src/foo.ts, ok')).toEqual([
      { start: 4, end: 15, path: 'src/foo.ts', quoted: false },
    ])
  })

  test('spans include the surrounding quotes', () => {
    const text = 'open @"a b.txt"'
    const [match] = findMentions(text)
    expect(text.slice(match.start, match.end)).toBe('@"a b.txt"')
    expect(match).toMatchObject({ path: 'a b.txt', quoted: true })
  })
})

describe('filterMentions', () => {
  const files = ['src/foo/bar.ts', 'foo.ts', 'src/lib/foobar.ts', 'README.md']
  const paths = (query: string, limit?: number) =>
    filterMentions(files, query, limit).map((entry) => entry.path)

  test('ranks basename matches ahead of path-only matches', () => {
    const result = paths('foo')
    expect(result[0]).toBe('foo.ts')
    expect(result).toContain('src/foo/bar.ts')
    expect(result).not.toContain('README.md')
  })

  test('surfaces matching directories in fuzzy mode', () => {
    expect(filterMentions(files, 'foo')).toContainEqual({
      path: 'src/foo/',
      isDir: true,
    })
  })

  test('supports subsequence matching', () => {
    expect(paths('fbar')).toContain('src/lib/foobar.ts')
  })

  test('lists top-level children for an empty query, directories first', () => {
    const result = filterMentions(files, '')
    expect(result).toEqual([
      { path: 'src/', isDir: true },
      { path: 'foo.ts', isDir: false },
      { path: 'README.md', isDir: false },
    ])
  })

  test('lists a directory’s immediate children for a slashed query', () => {
    expect(filterMentions(files, 'src/')).toEqual([
      { path: 'src/foo/', isDir: true },
      { path: 'src/lib/', isDir: true },
    ])
  })

  test('filters directory children by the trailing term', () => {
    expect(filterMentions(files, 'src/lib/')).toEqual([
      { path: 'src/lib/foobar.ts', isDir: false },
    ])
  })

  test('honors the limit', () => {
    expect(paths('o', 1)).toHaveLength(1)
  })
})

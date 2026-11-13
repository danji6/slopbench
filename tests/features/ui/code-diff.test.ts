import { parseDiffLines } from '@cv/client/lib/shiki/diff'
import { diffTextParts } from '@cv/client/lib/shiki/intraline'
import { describe, expect, test } from 'bun:test'

function changes(diff: string) {
  const parsed = parseDiffLines(diff)
  return parsed.code.split('\n').map((text, index) =>
    diffTextParts(text, parsed.lines[index].changes)
      .filter((part) => part.changed)
      .map((part) => part.text),
  )
}

describe('inline diff ranges', () => {
  test('ignores the patch terminator while preserving empty source lines', () => {
    const parsed = parseDiffLines('-old\n+new\n')
    expect(parsed.code).toBe('old\nnew')
    expect(parsed.lines.map((line) => line.type)).toEqual(['remove', 'add'])

    const blankContext = parseDiffLines('-old\n+new\n \n')
    expect(blankContext.code).toBe('old\nnew\n')
    expect(blankContext.lines.map((line) => line.type)).toEqual([
      'remove',
      'add',
      'context',
    ])
  })

  test('isolates multiple changed words and significant whitespace', () => {
    expect(
      changes('-const theme = "dark";  // old\n+const theme = "light"; // new'),
    ).toEqual([
      ['dark', '  ', 'old'],
      ['light', ' ', 'new'],
    ])
  })

  test('handles different line counts without comparing across hunks', () => {
    expect(
      changes(
        '@@ -1 +1,2 @@\n-const theme = "dark"\n+const theme = "light"\n+apply(theme)\n@@ -10 +11 @@\n-removed\n+added',
      ),
    ).toEqual([
      ['dark'],
      ['light'],
      ['apply(theme)'],
      [],
      ['removed'],
      ['added'],
    ])
  })

  test('preserves Unicode, HTML, whitespace and exact rendered text', () => {
    const parsed = parseDiffLines('-\t"🌙" < old\n+\t"☀️" < new')
    const lines = parsed.code.split('\n')
    for (const [index, line] of lines.entries()) {
      expect(
        diffTextParts(line, parsed.lines[index].changes)
          .map((part) => part.text)
          .join(''),
      ).toBe(line)
    }
    expect(changes('-\t"🌙" < old\n+\t"☀️" < new')).toEqual([
      ['🌙', 'old'],
      ['☀️', 'new'],
    ])
  })

  test('leaves standalone additions, deletions and oversized replacements alone', () => {
    expect(changes('+new file\n+second line')).toEqual([[], []])
    expect(changes('-deleted file')).toEqual([[]])
    expect(changes(`-${'a'.repeat(8_001)}\n+replacement`)).toEqual([[], []])
    expect(changes(`-${'old '.repeat(200)}\n+${'new '.repeat(200)}`)).toEqual([
      [],
      [],
    ])
  })

  test('decorates changed ranges inside syntax tokens without altering text', async () => {
    const { runDiffHighlighter } = await import('@cv/client/lib/shiki/core')
    const html = await runDiffHighlighter(
      '-const value = "<old>"\n+const value = "<new>"',
      'typescript',
    )
    expect(html).toContain('class="diff-change"')
    expect(html).toContain('code-gutter')
    expect(html).toMatch(/&(?:lt|#x3C);/)
    expect(html).not.toContain('<old>')
    expect(html).not.toContain('<new>')
  })
})

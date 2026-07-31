/// <reference types="bun-types" />
import { parseShellCommand, unescapeShellPrefix } from '@sb/core/shell/command'
import { describe, expect, test } from 'bun:test'

describe('parseShellCommand', () => {
  test('reads the command after a `$ ` prefix', () => {
    expect(parseShellCommand('$ ls -la')).toBe('ls -la')
    expect(parseShellCommand('$\tls')).toBe('ls')
    expect(parseShellCommand('$   git status  ')).toBe('git status')
  })

  test('keeps later lines verbatim so heredocs survive', () => {
    expect(parseShellCommand("$ cat <<'EOF'\nline one\nEOF")).toBe(
      "cat <<'EOF'\nline one\nEOF",
    )
  })

  test('needs whitespace after the `$`', () => {
    expect(parseShellCommand('$ls')).toBeNull()
    expect(parseShellCommand('$')).toBeNull()
    expect(parseShellCommand('$ ')).toBeNull()
  })

  test('leaves math and interpreter blocks alone', () => {
    expect(parseShellCommand('$$x + y$$')).toBeNull()
    expect(parseShellCommand('$```\ncode\n```')).toBeNull()
  })

  test('ignores a `$` that does not open the message', () => {
    expect(parseShellCommand('run $ ls for me')).toBeNull()
    expect(parseShellCommand(' $ ls')).toBeNull()
  })

  test('treats an escaped prefix as ordinary text', () => {
    expect(parseShellCommand('\\$ 5 for coffee')).toBeNull()
  })
})

describe('unescapeShellPrefix', () => {
  test('drops the backslash that escaped the prefix', () => {
    expect(unescapeShellPrefix('\\$ 5 for coffee')).toBe('$ 5 for coffee')
  })

  test('leaves everything else untouched', () => {
    expect(unescapeShellPrefix('$ ls')).toBe('$ ls')
    expect(unescapeShellPrefix('\\$5 for coffee')).toBe('\\$5 for coffee')
    expect(unescapeShellPrefix('plain text')).toBe('plain text')
  })
})

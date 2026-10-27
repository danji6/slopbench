/// <reference types="bun-types" />
import { needsEmulator } from '@sb/core/shell/ansi'
import type { AnsiLine } from '@sb/core/shell/ansi-scanner'
import { createAnsiScanner } from '@sb/core/shell/ansi-scanner'
import { describe, expect, test } from 'bun:test'

const text = (runs: AnsiLine[]) => runs.map((run) => run.text).join('')

/** Every line the scanner has produced so far, current line last. */
function lines(
  scanner: ReturnType<typeof createAnsiScanner>,
  chunks: string[],
) {
  const all: AnsiLine[][] = []
  let current: AnsiLine[] = []
  for (const chunk of chunks) {
    const scan = scanner.push(chunk)
    all.push(...scan.completed)
    current = scan.current
  }
  return [...all, current]
}

describe('createAnsiScanner', () => {
  test('splits lines and keeps plain text unstyled', () => {
    const result = lines(createAnsiScanner(), ['one\ntwo\n', 'three'])
    expect(result.map(text)).toEqual(['one', 'two', 'three'])
    expect(result[0]?.[0]?.style).toEqual({})
  })

  test('applies SGR colors and resets', () => {
    const [line] = lines(createAnsiScanner(), ['\u001b[31mred\u001b[0m plain'])
    expect(line?.map((run) => [run.text, run.style.fg])).toEqual([
      ['red', 'var(--shiki-red)'],
      [' plain', undefined],
    ])
  })

  test('carries SGR state and a split sequence across chunks', () => {
    const scanner = createAnsiScanner()
    const result = lines(scanner, ['\u001b[3', '2mgreen', ' still green'])
    expect(text(result[0] ?? [])).toBe('green still green')
    expect(
      result[0]?.every((run) => run.style.fg === 'var(--shiki-green)'),
    ).toBe(true)
  })

  test('resolves carriage returns by overwriting from column zero', () => {
    const [line] = lines(createAnsiScanner(), ['progress 10%\rprogress 100%'])
    expect(text(line ?? [])).toBe('progress 100%')

    const [short] = lines(createAnsiScanner(), ['long line\rok'])
    expect(text(short ?? [])).toBe('okng line')
  })

  test('erases to the end of the line on CSI K', () => {
    const [line] = lines(createAnsiScanner(), ['stale text\r\u001b[Knew'])
    expect(text(line ?? [])).toBe('new')
  })

  test('drops escapes it cannot represent', () => {
    const [line] = lines(createAnsiScanner(), [
      '\u001b]0;window title\u0007hello\u001b(B',
    ])
    expect(text(line ?? [])).toBe('hello')
  })

  test('reads 256-color and truecolor', () => {
    const [line] = lines(createAnsiScanner(), [
      '\u001b[38;5;196ma\u001b[38;2;1;2;3mb',
    ])
    expect(line?.map((run) => run.style.fg)).toEqual([
      'rgb(255 0 0)',
      'rgb(1 2 3)',
    ])
  })

  test('bold, dim and inverse map to style flags', () => {
    const [line] = lines(createAnsiScanner(), ['\u001b[1;2;7;31mx'])
    expect(line?.[0]?.style).toMatchObject({
      bold: true,
      dim: true,
      // inverse swaps the resolved colors
      fg: 'var(--surface-container-lowest)',
      bg: 'var(--shiki-red)',
    })
  })

  test('reset() drops carried state', () => {
    const scanner = createAnsiScanner()
    scanner.push('\u001b[31mred')
    scanner.reset()
    const { current } = scanner.push('plain')
    expect(current[0]?.style.fg).toBeUndefined()
  })
})

describe('needsEmulator', () => {
  test('is true for alt-screen and vertical cursor addressing', () => {
    expect(needsEmulator('\u001b[?1049h')).toBe(true)
    expect(needsEmulator('\u001b[2J')).toBe(true)
    expect(needsEmulator('\u001b[3A')).toBe(true)
    expect(needsEmulator('\u001b[1;1H')).toBe(true)
  })

  test('is false for colors, erase-in-line and column moves', () => {
    expect(needsEmulator('\u001b[31mred\u001b[0m')).toBe(false)
    expect(needsEmulator('spin\u001b[K')).toBe(false)
    expect(needsEmulator('\u001b[0Gredraw')).toBe(false)
    expect(needsEmulator('progress 10%\rprogress 100%')).toBe(false)
  })
})

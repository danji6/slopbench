/**
 * ANSI escape handling shared by the server's output accumulator and the
 * client's plain text terminal renderer.
 */

/** The 16 ANSI colors as M3/Shiki custom properties, in palette order. */
export const ANSI_COLOR_VARS = [
  '--surface-container-low', // black
  '--shiki-red',
  '--shiki-green',
  '--shiki-yellow',
  '--shiki-blue',
  '--shiki-purple', // magenta
  '--shiki-cyan',
  '--on-surface-variant', // white
  '--outline', // bright black
  '--shiki-red',
  '--shiki-green',
  '--shiki-yellow',
  '--shiki-blue',
  '--shiki-pink', // bright magenta
  '--shiki-cyan',
  '--on-surface', // bright white
] as const

export const ANSI_FOREGROUND_VAR = '--on-surface'
export const ANSI_BACKGROUND_VAR = '--surface-container-lowest'

export const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g

/** Strips ANSI escapes and resolves carriage return overwrites (progress bars). */
export function stripTerminalCodes(text: string): string {
  const plain = text.replace(ANSI_PATTERN, '').replace(/\r+\n/g, '\n')
  if (!plain.includes('\r')) return plain
  return plain.split('\n').map(resolveCarriageReturns).join('\n')
}

export function resolveCarriageReturns(line: string): string {
  let result = ''
  for (const segment of line.split('\r')) {
    result = segment + result.slice(segment.length)
  }
  return result
}

/**
 * Alternate screen toggles, vertical cursor addressing and screen erases,
 * sequences a line renderer cannot represent.
 */
const EMULATOR_SEQUENCES =
  // eslint-disable-next-line no-control-regex
  /\u001b\[(?:\?(?:1049|1047|47)[hl]|[0-9;]*[ABEFHJSTdf])/

/** True when the output needs a real terminal emulator to render faithfully. */
export function needsEmulator(text: string): boolean {
  return EMULATOR_SEQUENCES.test(text)
}

export type AnsiEscape = {
  length: number
  /** CSI final byte, or undefined for escapes with no parameters. */
  final?: string
  params?: string
}

/**
 * Longest escape we will wait for across a chunk boundary before giving up and
 * dropping the ESC as a stray byte.
 */
const MAX_ESCAPE_CHARS = 64

/* eslint-disable no-control-regex */
const CSI_RE = /\u001b\[([0-9;:?<>=]*)[ -/]*([@-~])/y
const OSC_RE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/y
const CHARSET_RE = /\u001b[ -/][0-~]/y
const SIMPLE_RE = /\u001b[@-Z\\-_]/y
/* eslint-enable no-control-regex */

/**
 * Matches the escape sequence starting at `index`.
 * Returns null when the text ends mid-sequence and the caller should carry it
 * over to the next chunk.
 */
export function matchEscape(text: string, index: number): AnsiEscape | null {
  CSI_RE.lastIndex = index
  const csi = CSI_RE.exec(text)
  if (csi) return { length: csi[0].length, params: csi[1], final: csi[2] }

  for (const pattern of [OSC_RE, CHARSET_RE, SIMPLE_RE]) {
    pattern.lastIndex = index
    const match = pattern.exec(text)
    if (match) return { length: match[0].length }
  }

  // Unrecognized and too long to still be an incomplete sequence
  if (text.length - index > MAX_ESCAPE_CHARS) return { length: 1 }
  return null
}

/** Resolves an xterm color index to a CSS color value. */
export function ansiIndexColor(index: number): string | undefined {
  if (index < 0 || index > 255) return undefined
  if (index < 16) return `var(${ANSI_COLOR_VARS[index]})`
  if (index < 232) {
    const offset = index - 16
    return rgb(
      cubeLevel(Math.floor(offset / 36) % 6),
      cubeLevel(Math.floor(offset / 6) % 6),
      cubeLevel(offset % 6),
    )
  }
  const gray = 8 + (index - 232) * 10
  return rgb(gray, gray, gray)
}

function cubeLevel(value: number): number {
  return value === 0 ? 0 : 55 + value * 40
}

function rgb(r: number, g: number, b: number): string {
  return `rgb(${r} ${g} ${b})`
}

import {
  ANSI_BACKGROUND_VAR,
  ANSI_FOREGROUND_VAR,
  ansiIndexColor,
  matchEscape,
} from './ansi'

const TAB_WIDTH = 8
const ESC = '\u001b'

export type AnsiStyle = {
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
}

/** A styled line of text. */
export type AnsiLine = { text: string; style: AnsiStyle }

export type AnsiScan = {
  /** Lines finished by this chunk, in order. */
  completed: AnsiLine[][]
  /** The last open line. Replaces the one returned by the last scan. */
  current: AnsiLine[]
}

export type AnsiScanner = {
  push: (chunk: string) => AnsiScan
  reset: () => void
}

/** Distinguishes styles for line merging and DOM reuse. */
export function ansiStyleKey(style: AnsiStyle): string {
  return [
    style.fg ?? '',
    style.bg ?? '',
    style.bold ? 'b' : '',
    style.dim ? 'd' : '',
    style.italic ? 'i' : '',
    style.underline ? 'u' : '',
    style.strike ? 's' : '',
  ].join('|')
}

/**
 * Turns a stream of terminal output into styled lines.
 * Keeps SGR state and a partial escape sequence across chunk boundaries.
 * Escapes it can't represent linearly are dropped.
 */
export function createAnsiScanner(): AnsiScanner {
  let carry = ''
  let sgr: SgrState = {}
  let line: AnsiLine[] = []
  let cursor = 0

  const write = (text: string) => {
    if (!text) return
    line = writeLines(line, cursor, text, resolveStyle(sgr))
    cursor += text.length
  }

  const push = (chunk: string): AnsiScan => {
    const completed: AnsiLine[][] = []
    const text = carry + chunk
    carry = ''

    let index = 0
    let plain = ''
    const flush = () => {
      write(plain)
      plain = ''
    }

    while (index < text.length) {
      const char = text[index] as string

      if (char === ESC) {
        const escape = matchEscape(text, index)
        if (!escape) {
          carry = text.slice(index)
          break
        }
        flush()
        if (escape.final === 'm') sgr = applySgr(sgr, escape.params ?? '')
        else if (escape.final === 'K') line = eraseLine(line, escape, cursor)
        else cursor = moveCursor(escape, cursor)
        index += escape.length
        continue
      }

      if (CONTROL_CHARS.has(char)) {
        flush()
        if (char === '\n') {
          completed.push(mergeLines(line))
          line = []
          cursor = 0
        } else if (char === '\r') cursor = 0
        else if (char === '\b') cursor = Math.max(0, cursor - 1)
        else write(' '.repeat(TAB_WIDTH - (cursor % TAB_WIDTH)))
        index += 1
        continue
      }

      plain += char
      index += 1
    }
    flush()

    return { completed, current: mergeLines(line) }
  }

  const reset = () => {
    carry = ''
    sgr = {}
    line = []
    cursor = 0
  }

  return { push, reset }
}

const CONTROL_CHARS = new Set(['\n', '\r', '\b', '\t'])

type Escape = { final?: string; params?: string }

function escapeAmount(escape: Escape, fallback: number): number {
  const amount = Number.parseInt(escape.params ?? '', 10)
  return Number.isNaN(amount) ? fallback : amount
}

/** Applies the horizontal cursor moves a line renderer can honor. */
function moveCursor(escape: Escape, cursor: number): number {
  switch (escape.final) {
    case 'G':
      return Math.max(0, escapeAmount(escape, 1) - 1)
    case 'C':
      return cursor + escapeAmount(escape, 1)
    case 'D':
      return Math.max(0, cursor - escapeAmount(escape, 1))
    default:
      return cursor
  }
}

/** `CSI K`: 0 erases to the end of the line, 1 to its start, 2 the whole line. */
function eraseLine(
  lines: AnsiLine[],
  escape: Escape,
  cursor: number,
): AnsiLine[] {
  const mode = escapeAmount(escape, 0)
  if (mode === 2) return []
  if (mode === 1) return writeLines(lines, 0, ' '.repeat(cursor), {})
  return sliceLines(lines, 0, cursor)
}

type SgrState = AnsiStyle & { inverse?: boolean }

function resolveStyle(state: SgrState): AnsiStyle {
  const { inverse, ...style } = state
  if (!inverse) return style
  return {
    ...style,
    fg: state.bg ?? `var(${ANSI_BACKGROUND_VAR})`,
    bg: state.fg ?? `var(${ANSI_FOREGROUND_VAR})`,
  }
}

function applySgr(state: SgrState, params: string): SgrState {
  const codes = params.replace(/:/g, ';').split(';')
  let next = { ...state }

  for (let index = 0; index < codes.length; index += 1) {
    const code = Number.parseInt(codes[index] ?? '', 10)
    if (Number.isNaN(code) || code === 0) {
      next = {}
      continue
    }
    if (code === 38 || code === 48) {
      const extended = readExtendedColor(codes, index)
      index = extended.index
      next[code === 38 ? 'fg' : 'bg'] = extended.color
      continue
    }
    next = applySgrCode(next, code)
  }
  return next
}

const ATTRIBUTES: Record<number, keyof SgrState> = {
  1: 'bold',
  2: 'dim',
  3: 'italic',
  4: 'underline',
  7: 'inverse',
  9: 'strike',
}

const COLOR_BASES: [number, 'fg' | 'bg', number][] = [
  [30, 'fg', 0],
  [40, 'bg', 0],
  [90, 'fg', 8],
  [100, 'bg', 8],
]

function applySgrCode(state: SgrState, code: number): SgrState {
  const attribute = ATTRIBUTES[code]
  if (attribute) return { ...state, [attribute]: true }

  if (code === 22) return { ...state, bold: false, dim: false }
  if (code >= 21 && code <= 29) {
    const cleared = ATTRIBUTES[code - 20]
    return cleared ? { ...state, [cleared]: false } : state
  }
  if (code === 39) return { ...state, fg: undefined }
  if (code === 49) return { ...state, bg: undefined }

  for (const [base, channel, offset] of COLOR_BASES) {
    if (code >= base && code <= base + 7) {
      return { ...state, [channel]: ansiIndexColor(code - base + offset) }
    }
  }
  return state
}

/** Reads a `38;5;n` / `38;2;r;g;b` color, returning the index it consumed up to. */
function readExtendedColor(codes: string[], index: number) {
  const mode = Number.parseInt(codes[index + 1] ?? '', 10)
  if (mode === 5) {
    return {
      index: index + 2,
      color: ansiIndexColor(Number.parseInt(codes[index + 2] ?? '', 10)),
    }
  }
  if (mode === 2) {
    const [r, g, b] = [2, 3, 4].map((offset) =>
      Number.parseInt(codes[index + offset] ?? '', 10),
    )
    const valid = [r, g, b].every((value) => Number.isInteger(value))
    return {
      index: index + 4,
      color: valid ? `rgb(${r} ${g} ${b})` : undefined,
    }
  }
  return { index: index + 1, color: undefined }
}

function linesLength(lines: AnsiLine[]): number {
  return lines.reduce((total, line) => total + line.text.length, 0)
}

/** Extracts `[from, to)` of a line, preserving the style. */
function sliceLines(lines: AnsiLine[], from: number, to: number): AnsiLine[] {
  const slice: AnsiLine[] = []
  let position = 0
  for (const line of lines) {
    const start = position
    position += line.text.length
    if (position <= from) continue
    if (start >= to) break
    const text = line.text.slice(
      Math.max(0, from - start),
      Math.max(0, Math.min(line.text.length, to - start)),
    )
    if (text) slice.push({ text, style: line.style })
  }
  return slice
}

/** Overwrites `text` into the line at column `at`, padding any gap. */
function writeLines(
  lines: AnsiLine[],
  at: number,
  text: string,
  style: AnsiStyle,
): AnsiLine[] {
  if (!text) return lines
  const length = linesLength(lines)
  const head = sliceLines(lines, 0, at)
  if (length < at) head.push({ text: ' '.repeat(at - length), style: {} })
  return [
    ...head,
    { text, style },
    ...sliceLines(lines, at + text.length, length),
  ]
}

/** Collapses adjacent lines sharing a style so the DOM stays small. */
function mergeLines(lines: AnsiLine[]): AnsiLine[] {
  const merged: AnsiLine[] = []
  for (const line of lines) {
    const last = merged.at(-1)
    if (last && ansiStyleKey(last.style) === ansiStyleKey(line.style)) {
      merged[merged.length - 1] = {
        text: last.text + line.text,
        style: last.style,
      }
    } else {
      merged.push(line)
    }
  }
  return merged
}

import type { ShellAnsiState, ShellToolOutput } from '../types/tools'
import { stripTerminalCodes } from './ansi'

export const SHELL_PAGE_CHARS = 24_000
export const SHELL_TERM_TAIL_CHARS = 48_000

/** Avoids cutting a UTF-16 surrogate pair at the page boundary. */
export function outputPrefixLength(text: string, limit: number): number {
  let end = Math.min(text.length, limit)
  const last = text.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return end
}

/** Strips terminal escapes while carrying their finite parser state between pages. */
export function plainOutputPage(
  text: string,
  initial: ShellAnsiState = 'text',
) {
  let state = initial
  let plain = ''
  for (const char of text) {
    if (state === 'osc') {
      if (char === '\x07') state = 'text'
      else if (char === '\x1b') state = 'oscEscape'
    } else if (state === 'oscEscape') {
      if (char === '\\' || char === '\x07') state = 'text'
      else if (char !== '\x1b') state = 'osc'
    } else if (state === 'csi') {
      if (char >= '@' && char <= '~') state = 'text'
    } else if (state === 'charset') {
      state = 'text'
    } else if (state === 'escape') {
      if (char === '[') state = 'csi'
      else if (char === ']') state = 'osc'
      else if (char >= ' ' && char <= '/') state = 'charset'
      else if (char !== '\x1b') state = 'text'
    } else if (char === '\x1b') {
      state = 'escape'
    } else {
      plain += char
    }
  }
  return { text: stripTerminalCodes(plain), state }
}

/** Formats a bounded result without including terminal scrollback. */
export function formatOutputPage(output: ShellToolOutput): string {
  const range = output.range
  if (!range) return output.text

  const status = output.status === 'background' ? 'running' : output.status
  const exit = output.exitCode === null ? '' : `; exit code ${output.exitCode}`

  const lines = [
    `Job ${output.jobId}: ${status}${exit}.`,
    `Output offsets ${range.startOffset}–${range.nextOffset}; next offset ${range.nextOffset}.`,
  ]

  for (const gap of range.unavailable)
    lines.push(`Output offsets ${gap.start}–${gap.end} are no longer retained.`)
  lines.push(output.text || '(No new output.)')

  if (range.hasMore) {
    const offset = range.replay ? `, offset: ${range.nextOffset}` : ''
    lines.push(
      `More unread output is available. Continue with shell_output({jobId: "${output.jobId}"${offset}}).`,
    )
  }

  return lines.join('\n')
}

export const TERMINAL_GAP_MARKER =
  '\r\n\u001b[2m[... output truncated ...]\u001b[0m\r\n'

export type TerminalFeedWrite = {
  data: string
  writtenThrough: number
}

export function computeTerminalFeed(
  writtenThrough: number | null,
  term: string,
  termOffset: number,
): TerminalFeedWrite | null {
  const end = termOffset + term.length

  if (writtenThrough === null) {
    return { data: term, writtenThrough: end }
  }
  if (writtenThrough < termOffset) {
    return { data: TERMINAL_GAP_MARKER + term, writtenThrough: end }
  }
  if (end > writtenThrough) {
    return {
      data: term.slice(writtenThrough - termOffset),
      writtenThrough: end,
    }
  }
  return null
}

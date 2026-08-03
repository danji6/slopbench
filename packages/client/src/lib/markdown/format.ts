/** Matches an opening or closing code fence. */
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})/

/**
 * Normalizes line endings and drops the whitespace at the end of every line
 * after a break (TipTap hard breaks serialize as two trailing spaces). Code
 * fences and the last line stay untouched.
 */
export function trimLineEnds(markdown: string): string {
  let fence: string | null = null

  const lines = markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line, index, all) => {
      const open = fence
      const delimiter = CODE_FENCE.exec(line)?.[1]
      const last = index === all.length - 1
      if (!open) {
        fence = delimiter ?? null
        return last ? line : line.trimEnd()
      }
      if (
        delimiter &&
        delimiter[0] === open[0] &&
        delimiter.length >= open.length
      ) {
        fence = null
        return last ? line : line.trimEnd()
      }
      return line
    })

  return lines.join('\n')
}

/** Formats markdown for storage. */
export function formatMarkdown(markdown: string): string {
  return trimLineEnds(markdown).trim()
}

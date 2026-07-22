/** Matches an opening or closing code fence, including the `$\`\`\`` form. */
const CODE_FENCE = /^ {0,3}\$?(`{3,}|~{3,})/

/**
 * Formats markdown for storage: normalizes line endings, drops whitespaces at
 * the end of every line (TipTap hard breaks), and trims the document.
 */
export function formatMarkdown(markdown: string): string {
  let fence: string | null = null

  const formatted = markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const open = fence
      const delimiter = CODE_FENCE.exec(line)?.[1]
      if (!open) {
        fence = delimiter ?? null
        return line.trimEnd()
      }
      if (
        delimiter &&
        delimiter[0] === open[0] &&
        delimiter.length >= open.length
      ) {
        fence = null
        return line.trimEnd()
      }
      return line
    })

  return formatted.join('\n').trim()
}

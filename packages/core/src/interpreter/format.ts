/**
 * Marks a line the interpreter consumed. A NUL is used because prompt text
 * cannot contain one.
 */
export const CONSUMED_LINE = String.fromCharCode(0)

/**
 * Renders the evaluated parts as text. Consumed lines disappear, and blank
 * lines around them collapse to a single one.
 */
export function formatOutput(text: string): string {
  const lines: string[] = []
  let blanks = 0
  let consumed = false

  for (const raw of text.split('\n')) {
    const line = raw.replaceAll(CONSUMED_LINE, '')
    if (line.trim() === '') {
      if (line !== raw) consumed = true
      else blanks++
      continue
    }

    const padding = consumed ? Math.min(blanks, 1) : blanks
    if (lines.length > 0 || !consumed) {
      for (let i = 0; i < padding; i++) lines.push('')
    }
    lines.push(line)
    blanks = 0
    consumed = false
  }

  return lines.join('\n').trimEnd()
}

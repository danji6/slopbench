export type DiffLineType = 'add' | 'remove' | 'context' | 'meta'

export type ParsedDiffLine = {
  type: DiffLineType
  oldNo: number | null
  newNo: number | null
}

export type ParsedDiff = {
  code: string
  lines: ParsedDiffLine[]
  hasHunks: boolean
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * Parse a unified diff into the lines that get rendered plus
 * the old/new line number of each line when hunk headers are
 * present.
 */
export function parseDiffLines(diff: string): ParsedDiff {
  const code: string[] = []
  const lines: ParsedDiffLine[] = []
  let oldNo = 0
  let newNo = 0
  let hunks = 0
  let hasHunks = false

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++') || raw.startsWith('---')) continue // file headers
    if (raw.startsWith('@@')) {
      const match = HUNK_HEADER.exec(raw)
      if (match) {
        oldNo = Number(match[1])
        newNo = Number(match[2])
        hasHunks = true
      }
      // Show a separator between hunks
      if (++hunks > 1) {
        code.push('⋯')
        lines.push({ type: 'meta', oldNo: null, newNo: null })
      }
    } else if (raw.startsWith('+')) {
      code.push(raw.slice(1))
      lines.push({ type: 'add', oldNo: null, newNo })
      newNo++
    } else if (raw.startsWith('-')) {
      code.push(raw.slice(1))
      lines.push({ type: 'remove', oldNo, newNo: null })
      oldNo++
    } else {
      code.push(raw.startsWith(' ') ? raw.slice(1) : raw)
      lines.push({ type: 'context', oldNo, newNo })
      oldNo++
      newNo++
    }
  }

  return { code: code.join('\n'), lines, hasHunks }
}

export function diffVisualText(diff: string): string {
  return parseDiffLines(diff).code
}

/** `<number> <sign>` gutter formatting for the diff renderer. */
export function diffGutters(
  lines: ParsedDiffLine[],
  hasHunks: boolean,
): string[] {
  const width = hasHunks
    ? lines.reduce((max, line) => {
        const no = line.type === 'remove' ? line.oldNo : line.newNo
        return Math.max(max, no === null ? 0 : String(no).length)
      }, 1)
    : 0

  return lines.map((line) => {
    const sign = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '
    if (!hasHunks) return sign
    if (line.type === 'meta') return ' '.repeat(width + 2)
    const no = line.type === 'remove' ? line.oldNo : line.newNo
    return `${String(no ?? '').padStart(width)} ${sign}`
  })
}

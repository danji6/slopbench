export function applyEdits(
  content: string,
  edits: Array<{ oldText: string; newText: string }>,
  filePath: string,
) {
  if (edits.length === 0) throw new Error('At least one edit is required')

  const normalizedEdits = edits.map((edit) => ({
    oldText: normalizeToLf(edit.oldText),
    newText: normalizeToLf(edit.newText),
  }))

  for (const [index, edit] of normalizedEdits.entries()) {
    if (!edit.oldText) {
      throw getEmptyOldTextError(filePath, index, normalizedEdits.length)
    }
  }

  const initialMatches = normalizedEdits.map((edit) =>
    findText(content, edit.oldText),
  )
  const baseContent = initialMatches.some((match) => match.usedFuzzyMatch)
    ? normalizeForFuzzyMatch(content)
    : content

  const matchedEdits = normalizedEdits.map((edit, index) => {
    const match = findText(baseContent, edit.oldText)
    if (!match.found) {
      throw getNotFoundError(filePath, index, normalizedEdits.length)
    }

    const occurrences = countOccurrences(baseContent, edit.oldText)
    if (occurrences > 1) {
      throw getDuplicateError(
        filePath,
        index,
        normalizedEdits.length,
        occurrences,
      )
    }

    return {
      editIndex: index,
      matchIndex: match.index,
      matchLength: match.matchLength,
      newText: edit.newText,
    }
  })

  matchedEdits.sort((a, b) => a.matchIndex - b.matchIndex)
  for (let index = 1; index < matchedEdits.length; index++) {
    const previous = matchedEdits[index - 1]
    const current = matchedEdits[index]
    if (previous.matchIndex + previous.matchLength > current.matchIndex) {
      throw new Error(
        `edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${filePath}. Merge them into one edit or target disjoint regions.`,
      )
    }
  }

  let output = baseContent
  for (let index = matchedEdits.length - 1; index >= 0; index--) {
    const edit = matchedEdits[index]
    output = `${output.slice(0, edit.matchIndex)}${edit.newText}${output.slice(edit.matchIndex + edit.matchLength)}`
  }

  if (output === baseContent) {
    throw getNoChangeError(filePath, normalizedEdits.length)
  }

  return output
}

const DIFF_CONTEXT = 3

/** Build a git-style unified diff with hunk headers and surrounding context. */
export function createUnifiedDiff(
  filePath: string,
  oldContent: string,
  newContent: string,
  context = DIFF_CONTEXT,
) {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')
  const hunks = buildHunks(diffOps(oldLines, newLines), context)
  if (hunks.length === 0) return ''

  const out: string[] = [`--- ${filePath}`, `+++ ${filePath}`]
  for (const hunk of hunks) {
    out.push(
      `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
    )
    for (const line of hunk.lines) {
      const prefix =
        line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '
      out.push(prefix + line.text)
    }
  }

  return out.join('\n')
}

/** Whether a full file write would leave the existing content unchanged. */
export function isUnchangedWrite(previousContent: string, newContent: string) {
  return (
    normalizeToLf(stripBom(previousContent).text) ===
    normalizeToLf(stripBom(newContent).text)
  )
}

export function detectLineEnding(content: string): '\r\n' | '\n' {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

export function normalizeToLf(text: string) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function normalizeForFuzzyMatch(text: string) {
  return text
    .normalize('NFKC')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, ' ')
}

export function restoreLineEndings(text: string, ending: '\r\n' | '\n') {
  return ending === '\r\n' ? text.replace(/\n/g, '\r\n') : text
}

export function stripBom(content: string) {
  return content.startsWith('\uFEFF')
    ? { bom: '\uFEFF', text: content.slice(1) }
    : { bom: '', text: content }
}

function findText(content: string, oldText: string) {
  const exactIndex = content.indexOf(oldText)
  if (exactIndex !== -1) {
    return {
      found: true,
      index: exactIndex,
      matchLength: oldText.length,
      usedFuzzyMatch: false,
    }
  }

  const fuzzyContent = normalizeForFuzzyMatch(content)
  const fuzzyOldText = normalizeForFuzzyMatch(oldText)
  const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText)

  return {
    found: fuzzyIndex !== -1,
    index: fuzzyIndex,
    matchLength: fuzzyOldText.length,
    usedFuzzyMatch: fuzzyIndex !== -1,
  }
}

type DiffOp = { type: 'equal' | 'add' | 'remove'; text: string }

function diffOps(oldLines: string[], newLines: string[]): DiffOp[] {
  let prefix = 0
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix++
  }

  let oldEnd = oldLines.length
  let newEnd = newLines.length
  while (
    oldEnd > prefix &&
    newEnd > prefix &&
    oldLines[oldEnd - 1] === newLines[newEnd - 1]
  ) {
    oldEnd--
    newEnd--
  }

  const ops: DiffOp[] = []
  for (let i = 0; i < prefix; i++)
    ops.push({ type: 'equal', text: oldLines[i] })
  ops.push(
    ...diffMiddle(
      oldLines.slice(prefix, oldEnd),
      newLines.slice(prefix, newEnd),
    ),
  )
  for (let i = oldEnd; i < oldLines.length; i++)
    ops.push({ type: 'equal', text: oldLines[i] })

  return ops
}

function diffMiddle(oldLines: string[], newLines: string[]): DiffOp[] {
  if (oldLines.length === 0)
    return newLines.map((text) => ({ type: 'add' as const, text }))
  if (newLines.length === 0)
    return oldLines.map((text) => ({ type: 'remove' as const, text }))

  if (oldLines.length * newLines.length > 4_000_000) {
    return [
      ...oldLines.map((text) => ({ type: 'remove' as const, text })),
      ...newLines.map((text) => ({ type: 'add' as const, text })),
    ]
  }

  const columnCount = newLines.length + 1
  const table = new Uint32Array((oldLines.length + 1) * columnCount)
  const get = (oldIndex: number, newIndex: number) =>
    table[oldIndex * columnCount + newIndex]
  const set = (oldIndex: number, newIndex: number, value: number) => {
    table[oldIndex * columnCount + newIndex] = value
  }

  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex--) {
      set(
        oldIndex,
        newIndex,
        oldLines[oldIndex] === newLines[newIndex]
          ? get(oldIndex + 1, newIndex + 1) + 1
          : Math.max(get(oldIndex + 1, newIndex), get(oldIndex, newIndex + 1)),
      )
    }
  }

  const ops: DiffOp[] = []
  let oldIndex = 0
  let newIndex = 0

  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      ops.push({ type: 'equal', text: oldLines[oldIndex] })
      oldIndex++
      newIndex++
    } else if (get(oldIndex + 1, newIndex) >= get(oldIndex, newIndex + 1)) {
      ops.push({ type: 'remove', text: oldLines[oldIndex] })
      oldIndex++
    } else {
      ops.push({ type: 'add', text: newLines[newIndex] })
      newIndex++
    }
  }

  while (oldIndex < oldLines.length) {
    ops.push({ type: 'remove', text: oldLines[oldIndex] })
    oldIndex++
  }
  while (newIndex < newLines.length) {
    ops.push({ type: 'add', text: newLines[newIndex] })
    newIndex++
  }

  return ops
}

type HunkLine = { type: DiffOp['type']; text: string }
type Hunk = {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: HunkLine[]
}

function buildHunks(ops: DiffOp[], context: number): Hunk[] {
  if (!ops.some((op) => op.type !== 'equal')) return []

  const keep = new Array<boolean>(ops.length).fill(false)
  ops.forEach((op, index) => {
    if (op.type === 'equal') return
    const from = Math.max(0, index - context)
    const to = Math.min(ops.length - 1, index + context)
    for (let k = from; k <= to; k++) keep[k] = true
  })

  const hunks: Hunk[] = []
  let oldNo = 1
  let newNo = 1
  let current: Hunk | null = null

  ops.forEach((op, index) => {
    if (keep[index]) {
      current ??= {
        oldStart: oldNo,
        oldCount: 0,
        newStart: newNo,
        newCount: 0,
        lines: [],
      }
      current.lines.push({ type: op.type, text: op.text })
      if (op.type !== 'add') current.oldCount++
      if (op.type !== 'remove') current.newCount++
    } else if (current) {
      hunks.push(current)
      current = null
    }
    if (op.type !== 'add') oldNo++
    if (op.type !== 'remove') newNo++
  })
  if (current) hunks.push(current)

  return hunks
}

function countOccurrences(content: string, oldText: string) {
  const normalizedContent = normalizeForFuzzyMatch(content)
  const normalizedOldText = normalizeForFuzzyMatch(oldText)
  let count = 0
  let index = normalizedContent.indexOf(normalizedOldText)

  while (index !== -1) {
    count++
    index = normalizedContent.indexOf(
      normalizedOldText,
      index + normalizedOldText.length,
    )
  }

  return count
}

function getEmptyOldTextError(
  filePath: string,
  editIndex: number,
  totalEdits: number,
) {
  if (totalEdits === 1)
    return new Error(`oldText must not be empty in ${filePath}.`)
  return new Error(
    `edits[${editIndex}].oldText must not be empty in ${filePath}.`,
  )
}

function getNotFoundError(
  filePath: string,
  editIndex: number,
  totalEdits: number,
) {
  if (totalEdits === 1) {
    return new Error(
      `Could not find the exact text in ${filePath}. The oldText must match exactly including all whitespace and newlines.`,
    )
  }
  return new Error(
    `Could not find edits[${editIndex}] in ${filePath}. The oldText must match exactly including all whitespace and newlines.`,
  )
}

function getDuplicateError(
  filePath: string,
  editIndex: number,
  totalEdits: number,
  occurrences: number,
) {
  if (totalEdits === 1) {
    return new Error(
      `Found ${occurrences} occurrences of the text in ${filePath}. The text must be unique. Please provide more context to make it unique.`,
    )
  }
  return new Error(
    `Found ${occurrences} occurrences of edits[${editIndex}] in ${filePath}. Each oldText must be unique. Please provide more context to make it unique.`,
  )
}

function getNoChangeError(filePath: string, totalEdits: number) {
  if (totalEdits === 1) {
    return new Error(
      `No changes made to ${filePath}. The replacement produced identical content.`,
    )
  }
  return new Error(
    `No changes made to ${filePath}. The replacements produced identical content.`,
  )
}

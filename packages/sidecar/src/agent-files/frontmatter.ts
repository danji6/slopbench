import { parseDocument } from 'yaml'

/** Tolerates prose continued at column zero only in a plain description value. */
export function skillFrontmatter(header: string) {
  const strict = parseDocument(header, { uniqueKeys: true })
  if (!strict.errors.length) return strict
  const repaired = continueDescription(header)
  return repaired === header
    ? strict
    : parseDocument(repaired, { uniqueKeys: true })
}

function continueDescription(header: string) {
  const lines = header.split(/\r?\n/)
  let description = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^description:\s+[^\s|>"'[{!&*]/.test(line)) {
      description = true
      continue
    }
    if (!description || !line.trim() || /^\s/.test(line)) continue
    if (/^(?:[^:]+:\s|[^:]+:$|#|---|\.\.\.|[-?]\s)/.test(line)) {
      description = false
      continue
    }
    lines[i] = `  ${line}`
  }
  return lines.join('\n')
}

export type FileScope = 'workspace' | 'agent' | 'session'

export type ScopedPath = {
  scope: FileScope
  path: string
  explicit: boolean
}

/** Parses filesystem prefixes without URL decoding or host-dependent path rules. */
export function parseScopedPath(value: string): ScopedPath {
  const match = /^(agent|workspace|session):\/\//.exec(value)
  if (!match) {
    if (/^(?:agent|workspace|session):|^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
      throw new Error(
        'Invalid filesystem prefix; use agent://, workspace://, or session://',
      )
    }
    return { scope: 'workspace', path: value, explicit: false }
  }

  const filePath = value.slice(match[0].length)
  if (/^(?:[\\/]|[a-z]:)/i.test(filePath) || filePath.includes('\0')) {
    throw new Error('Scoped paths must be relative to their root')
  }
  let depth = 0
  for (const part of filePath.split(/[\\/]/)) {
    if (!part || part === '.') continue
    depth += part === '..' ? -1 : 1
    if (depth < 0) throw new Error('Path escapes the selected filesystem root')
  }
  return { scope: match[1] as FileScope, path: filePath || '.', explicit: true }
}

/** Preserves the chosen filesystem prefix in model-facing paths. */
export function scopedDisplayPath(input: string, relativePath: string): string {
  const parsed = parseScopedPath(input)
  if (!parsed.explicit) return relativePath
  return `${parsed.scope}://${relativePath === '.' ? '' : relativePath}`
}

export type MentionEntry = { path: string; isDir: boolean }

/**
 * Resolve `@`-mention candidates from a flat file index.
 *
 * - `@` (empty) or a query ending in `/` lists the immediate children of that
 *   directory, like `ls` (directories first, then files).
 * - Any other query fuzzy-searches the whole tree (files and directories).
 */
export function filterMentions(
  files: string[],
  query: string,
  limit = 50,
): MentionEntry[] {
  const slash = query.lastIndexOf('/')
  if (slash >= 0) {
    const dir = query.slice(0, slash + 1)
    return listChildren(files, dir, query.slice(slash + 1), limit)
  }
  if (!query) return listChildren(files, '', '', limit)
  return fuzzyMentions(files, query, limit)
}

/** Immediate children of `dir`, filtered by `term`. */
function listChildren(
  files: string[],
  dir: string,
  term: string,
  limit: number,
): MentionEntry[] {
  const dirs = new Set<string>()
  const fileNames = new Set<string>()

  for (const file of files) {
    if (!file.startsWith(dir)) continue
    const rest = file.slice(dir.length)
    if (!rest) continue
    const slash = rest.indexOf('/')
    if (slash > 0) dirs.add(rest.slice(0, slash))
    else fileNames.add(rest)
  }

  const entries: MentionEntry[] = [
    ...[...dirs].map((name) => ({ path: `${dir}${name}/`, isDir: true })),
    ...[...fileNames].map((name) => ({ path: `${dir}${name}`, isDir: false })),
  ]
  return rankEntries(entries, term, limit)
}

/** Fuzzy match across every file and its ancestor directories. */
function fuzzyMentions(
  files: string[],
  query: string,
  limit: number,
): MentionEntry[] {
  const entries: MentionEntry[] = [
    ...collectDirectories(files).map((path) => ({ path, isDir: true })),
    ...files.map((path) => ({ path, isDir: false })),
  ]
  return rankEntries(entries, query, limit)
}

function collectDirectories(files: string[]): string[] {
  const dirs = new Set<string>()
  for (const file of files) {
    let slash = file.indexOf('/')
    while (slash >= 0) {
      dirs.add(`${file.slice(0, slash)}/`)
      slash = file.indexOf('/', slash + 1)
    }
  }
  return [...dirs]
}

function rankEntries(
  entries: MentionEntry[],
  query: string,
  limit: number,
): MentionEntry[] {
  const q = query.toLowerCase()
  if (!q) return [...entries].sort(byKind).slice(0, limit)

  const scored: Array<{ entry: MentionEntry; score: number }> = []
  for (const entry of entries) {
    const lower = entry.path.toLowerCase()
    const base = baseName(lower)
    let score = -1
    if (base.startsWith(q)) score = 0
    else if (base.includes(q)) score = 1
    else if (lower.includes(q)) score = 2
    else if (isSubsequence(q, lower)) score = 3
    if (score >= 0) scored.push({ entry, score })
  }

  scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.entry.path.length - b.entry.path.length ||
      a.entry.path.localeCompare(b.entry.path),
  )
  return scored.slice(0, limit).map((item) => item.entry)
}

/** Directories before files, then alphabetical. */
function byKind(a: MentionEntry, b: MentionEntry): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
  return a.path.localeCompare(b.path)
}

function baseName(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path
  return trimmed.slice(trimmed.lastIndexOf('/') + 1)
}

function isSubsequence(query: string, text: string): boolean {
  let i = 0
  for (let j = 0; j < text.length && i < query.length; j++) {
    if (text[j] === query[i]) i++
  }
  return i === query.length
}

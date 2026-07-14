const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/
const HAS_EXTENSION = /\.[A-Za-z0-9]+$/

const QUOTED = '["\\u201C]([^"\\u201C\\u201D\\r\\n]*)["\\u201D]'
const BARE = '([^\\s@"\\u201C\\u201D]*)'
const MENTION_SCAN = new RegExp(`(?<!\\\\)@(?:${QUOTED}|${BARE})`, 'g')
const ACTIVE_MENTION_PATTERN = new RegExp(
  `(?<!\\\\)@(?:["\\u201C]([^"\\u201C\\u201D\\r\\n]*)|${BARE})$`,
)

/** Strip trailing punctuation and return the path if it's valid. */
export function normalizeMentionPath(raw: string): string | null {
  const path = raw.trim().replace(TRAILING_PUNCTUATION, '')
  if (!path) return null
  if (path.includes('/') || HAS_EXTENSION.test(path)) return path
  return null
}

export type MentionMatch = {
  /** Offset of the leading `@`. */
  start: number
  /** Offset just past the mention's last meaningful character. */
  end: number
  /** The referenced path, without quotes or trailing punctuation. */
  path: string
  /** Whether the source used the quoted form. */
  quoted: boolean
}

/** Locate every file mention in `text`, returning their spans and resolved paths. */
export function findMentions(text: string): MentionMatch[] {
  const matches: MentionMatch[] = []
  for (const match of text.matchAll(MENTION_SCAN)) {
    const start = match.index
    if (match[1] !== undefined) {
      const path = match[1].trim()
      if (path)
        matches.push({
          start,
          end: start + match[0].length,
          path,
          quoted: true,
        })
      continue
    }
    const token = match[2] ?? ''
    const path = normalizeMentionPath(token)
    if (path)
      matches.push({ start, end: start + 1 + path.length, path, quoted: false })
  }
  return matches
}

/** Extract all deduped file mention paths from a message text. */
export function parseFileMentions(text: string): string[] {
  const paths = new Set<string>()
  for (const { path } of findMentions(text)) paths.add(path)
  return [...paths]
}

/** Render a path as a mention token, quoting only when it contains spaces. */
export function mentionToken(path: string): string {
  return /\s/.test(path) ? `@"${path}"` : `@${path}`
}

export type ActiveMention = { query: string; start: number; end: number }

/** Unescaped, in-progress mention under the caret for the chat composer. */
export function getActiveMention(
  text: string,
  caret: number,
): ActiveMention | null {
  const match = ACTIVE_MENTION_PATTERN.exec(text.slice(0, caret))
  if (!match) return null
  const query = match[1] ?? match[2] ?? ''
  return { query, start: caret - match[0].length, end: caret }
}

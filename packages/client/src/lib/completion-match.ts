import type { Completion } from '@/components/ui/code-completion'
import Fuse from 'fuse.js'

/** Builds a Fuse index over a completion list, matched on the `label`. */
export function makeFuse(completions: Completion[]): Fuse<Completion> {
  return new Fuse(completions, {
    keys: ['label'],
    threshold: 0.6,
    ignoreLocation: false,
    isCaseSensitive: false,
  })
}

/** Fuzzy ranks a Fuse's entries against `query`, keeping only relevant matches. */
export function rankMatches(
  fuse: Fuse<Completion>,
  query: string,
): Completion[] {
  return fuse
    .search(query)
    .map((result) => result.item)
    .filter((item) => isRelevantMatch(item.label, query))
}

/**
 * Fuzzy filters completions against `query`, for callers that supply their own
 * candidate list. An empty query returns every completion.
 */
export function fuzzyFilter(
  completions: Completion[],
  query: string,
): Completion[] {
  if (!query) return completions
  return rankMatches(makeFuse(completions), query)
}

/** A camelCase or post-separator word boundary within a label. */
function isWordBoundary(label: string, i: number): boolean {
  if (i === 0) return true
  const c = label[i]!
  const prev = label[i - 1]!
  if (/[A-Z]/.test(c) && /[a-z0-9]/.test(prev)) return true
  return /[A-Za-z0-9]/.test(c) && /[^A-Za-z0-9]/.test(prev)
}

/** Whether a Fuse candidate is relevant enough to show. */
function isRelevantMatch(label: string, query: string): boolean {
  return isAbbreviationMatch(label, query) || isPrefixTypo(label, query)
}

/**
 * True when each query character lands on a word boundary or continues the
 * current word, and the match opens at the start or with a run of at least two
 * characters.
 */
function isAbbreviationMatch(label: string, query: string): boolean {
  const lower = label.toLowerCase()
  const q = query.toLowerCase()
  let li = 0
  let firstStart = -1
  let firstRun = 0

  for (let qi = 0; qi < q.length;) {
    let pos = -1
    for (let i = li; i < lower.length; i++) {
      if (isWordBoundary(label, i) && lower[i] === q[qi]) {
        pos = i
        break
      }
    }
    if (pos === -1) return false

    li = pos
    let run = 0
    while (qi < q.length && li < lower.length && lower[li] === q[qi]) {
      qi++
      li++
      run++
    }
    if (firstStart === -1) {
      firstStart = pos
      firstRun = run
    }
  }

  return firstStart === 0 || firstRun >= 2
}

/**
 * True when the query is within a small edit distance of the label's prefix,
 * allowing one error every four characters.
 */
function isPrefixTypo(label: string, query: string): boolean {
  const maxEdits = Math.floor(query.length / 4)
  if (maxEdits === 0) return false
  const prefix = label.toLowerCase().slice(0, query.length)
  return editDistance(query.toLowerCase(), prefix) <= maxEdits
}

/** Levenshtein distance between two strings. */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    for (let j = 1; j <= b.length; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]!
          : 1 + Math.min(prev[j - 1]!, prev[j]!, curr[j - 1]!)
    }
    prev = curr
  }
  return prev[b.length]!
}

import {
  type SessionSearch,
  type SessionSearchFilterKey,
  isSessionSearchFilter,
} from './filters'

type FilterPrefix = { key: SessionSearchFilterKey; end: number }
type FilterValues = { values: string[]; end: number }

function readPrefix(input: string, start: number): FilterPrefix | null {
  const boundary = start === 0 || /\s/.test(input[start - 1]!)
  if (!boundary) return null
  const match = /^([a-z]+):/i.exec(input.slice(start))
  const key = match?.[1]?.toLowerCase()
  if (!match || !key || !isSessionSearchFilter(key)) return null
  return { key, end: start + match[0].length }
}

/** Decodes supported escapes while preserving literal backslashes in names. */
function readEscape(input: string, start: number) {
  const next = input[start + 1]
  return next && '\\",'.includes(next)
    ? { value: next, end: start + 2 }
    : { value: '\\', end: start + 1 }
}

function afterComma(input: string, start: number): number | null {
  let index = start
  while (index < input.length && /\s/.test(input[index]!)) index++
  if (input[index] !== ',') return null
  index++
  while (index < input.length && /\s/.test(input[index]!)) index++
  return index
}

/** Reads one value, keeping quoted separators literal and accepting open quotes. */
function readValue(input: string, start: number) {
  let index = start
  let quoted = false
  let value = ''
  while (index < input.length) {
    const char = input[index]!
    if (!quoted && (char === ',' || /\s/.test(char))) break
    if (char === '\\') {
      const escaped = readEscape(input, index)
      value += escaped.value
      index = escaped.end
      continue
    }
    if (char === '"') quoted = !quoted
    else value += char
    index++
  }
  return { value: value.trim(), end: index }
}

function readValues(input: string, start: number): FilterValues {
  const values: string[] = []
  let index = start
  // A value must immediately follow the colon
  if (/\s/.test(input[index] ?? '')) return { values, end: index }
  while (index < input.length) {
    const next = readValue(input, index)
    if (next.value) values.push(next.value)
    const following = afterComma(input, next.end)
    if (following === null) return { values, end: next.end }
    index = following
  }
  return { values, end: index }
}

/** Separates registered filter clauses from the existing title search text. */
export function parseSessionSearch(input: string): SessionSearch {
  const clauses: SessionSearch['clauses'] = []
  const text: string[] = []
  let index = 0
  let textStart = 0
  let quoted = false
  while (index < input.length) {
    const prefix = quoted ? null : readPrefix(input, index)
    if (prefix) {
      text.push(input.slice(textStart, index).trim())
      const { values, end } = readValues(input, prefix.end)
      if (values.length) clauses.push({ key: prefix.key, values })
      index = textStart = end
      continue
    }
    if (input[index] === '\\') index += 2
    else {
      if (input[index] === '"') quoted = !quoted
      index++
    }
  }
  text.push(input.slice(textStart).trim())
  return { text: text.filter(Boolean).join(' '), clauses }
}

import { fuzzyFilter } from './match'
import type {
  CompletionItem,
  CompletionRange,
  CompletionRequest,
  CompletionValue,
} from './types'

/** Completes a standalone argument, preserving quotes and existing suffixes. */
export function argumentValues(
  request: CompletionRequest,
  range: CompletionRange,
  values: readonly (string | CompletionValue)[],
): CompletionItem[] | undefined {
  const end = Math.min(range.to, request.text.length)
  const argument = request.text.slice(range.from, end)
  const from = argument.trim()
    ? range.from + argument.length - argument.trimStart().length
    : request.offset
  const raw = request.text.slice(from, end).trimEnd()
  const quote = raw[0]
  const quoted = quote === "'" || quote === '"'

  if (quoted) {
    const strings = values.filter((value) => typeof value === 'string')
    return quotedValues(request, from, raw, strings)
  }
  if (!/^[\p{ID_Continue}$]*$/u.test(raw)) return

  const query = request.text.slice(from, request.offset)

  return fuzzyFilter(
    values.map((value) =>
      typeof value === 'string'
        ? { label: value, insertText: quoteValue(value, "'") }
        : value,
    ),
    query,
  ).map((entry) => ({
    ...entry,
    kind: 'value',
    from,
    to: from + raw.length,
  }))
}

function quotedValues(
  request: CompletionRequest,
  start: number,
  raw: string,
  values: readonly string[],
): CompletionItem[] | undefined {
  const quote = raw[0]!
  const closed = raw.length > 1 && raw.endsWith(quote)
  const end = start + raw.length - (closed ? 1 : 0)

  if (request.offset <= start || request.offset > end) return
  // Only a single string literal is eligible, not expressions containing strings
  if (hasInnerQuote(raw.slice(1, closed ? -1 : undefined), quote)) return

  const query = request.text.slice(start + 1, request.offset)

  return fuzzyFilter(
    values.map((label) => ({ label })),
    query,
  ).map((entry) => ({
    ...entry,
    kind: 'value',
    from: start + 1,
    to: end,
    insertText:
      quoteValue(entry.label, quote).slice(1, -1) + (closed ? '' : quote),
  }))
}

function hasInnerQuote(text: string, quote: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') i++
    else if (text[i] === quote) return true
  }
  return false
}

export function quoteValue(value: string, quote: string): string {
  return (
    quote +
    value
      .replaceAll('\\', '\\\\')
      .replaceAll(quote, '\\' + quote)
      .replaceAll('\n', '\\n')
      .replaceAll('\r', '\\r') +
    quote
  )
}

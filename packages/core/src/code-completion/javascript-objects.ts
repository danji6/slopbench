import type { Token } from 'acorn'

import type { JavaScriptSyntax } from './javascript-syntax'
import { quoteValue } from './javascript-values'
import { fuzzyFilter } from './match'
import type {
  CompletionItem,
  CompletionParameter,
  CompletionRange,
  CompletionRequest,
} from './types'

type PropertySegment = CompletionRange & { tokens: Token[] }

type PropertyEdit = CompletionRange & {
  query: string
  quote?: string
  suffix: string
}

type PropertyKey = {
  fields: readonly CompletionParameter[]
  used: Set<string>
  segment: PropertySegment
}

export type ArgumentTarget = {
  parameter?: CompletionParameter
  range?: CompletionRange
  path: string[]
  key?: PropertyKey
}

const UNFINISHED_QUOTED_KEY = /^(['"])(?:\\[^\n]|(?!\1)[^\\\n])*$/

/** Resolves metadata along direct inline object values, never arbitrary expressions. */
export function argumentTarget(
  syntax: JavaScriptSyntax,
  request: CompletionRequest,
  range: CompletionRange,
  parameter: CompletionParameter,
  path: string[] = [],
): ArgumentTarget {
  const tokens = syntax.tokens.filter(
    (token) =>
      token.start >= range.from &&
      token.start < range.to &&
      token.end > token.start,
  )

  if (tokens[0]?.type.label !== '{') return { parameter, range, path }
  if (!parameter.properties) return { path }

  const segments = propertySegments(
    tokens,
    Math.min(range.to, request.text.length),
  )

  return objectProperty(syntax, request, segments, parameter.properties, path)
}

function objectProperty(
  syntax: JavaScriptSyntax,
  request: CompletionRequest,
  segments: PropertySegment[],
  fields: readonly CompletionParameter[],
  path: string[],
): ArgumentTarget {
  const segment = segments.find(
    ({ from, to }) => from <= request.offset && request.offset <= to,
  )
  if (!segment) return { path }

  const colon = segment.tokens[1]
  if (colon?.type.label !== ':' || request.offset <= colon.start) {
    const used = new Set(
      segments.filter((entry) => entry !== segment).map(propertyName),
    )
    const current = keySegment(syntax, segment, request.offset)
    return { path, key: { fields, used, segment: current } }
  }

  const name = propertyName(segment)
  const field = fields.find((entry) => entry.name === name)
  if (!field) return { path }

  return argumentTarget(
    syntax,
    request,
    { from: colon.end, to: segment.to },
    field,
    [...path, name],
  )
}

/** Skips completed leading comments when loose parsing omitted a partial key. */
function keySegment(
  syntax: JavaScriptSyntax,
  segment: PropertySegment,
  offset: number,
): PropertySegment {
  if (segment.tokens.length) return segment
  const from = syntax.comments.reduce(
    (start, comment) =>
      comment.start >= start && comment.end <= offset ? comment.end : start,
    segment.from,
  )
  return { ...segment, from }
}

/** Splits only direct properties; commas in values belong to deeper syntax. */
function propertySegments(tokens: Token[], end: number): PropertySegment[] {
  const segments: PropertySegment[] = []
  let from = tokens[0]!.end
  let start = 1
  let depth = 0
  for (let index = 1; index < tokens.length; index++) {
    const token = tokens[index]!
    const label = token.type.label
    if (depth === 0 && (label === ',' || label === '}')) {
      segments.push({
        from,
        to: token.start,
        tokens: tokens.slice(start, index),
      })
      if (label === '}') return segments
      from = token.end
      start = index + 1
    }
    if (['(', '[', '{', '${'].includes(label)) depth++
    else if ([')', ']', '}'].includes(label)) depth--
  }
  segments.push({ from, to: end, tokens: tokens.slice(start) })

  return segments
}

function propertyName({ tokens }: PropertySegment): string {
  const key = tokens[0]
  if (!key || !['name', 'string'].includes(key.type.label)) return ''
  return String((key as Token & { value: unknown }).value)
}

/** Inserts a field and colon while preserving an existing value and quote style. */
export function propertyCompletions(
  request: CompletionRequest,
  { fields, used, segment }: PropertyKey,
): CompletionItem[] | undefined {
  const edit = propertyEdit(request, segment)
  if (!edit) return

  const { query, quote, suffix, ...range } = edit
  const candidates = fields.filter((field) => !used.has(field.name))

  return fuzzyFilter(
    candidates.map((field) => ({
      label: field.name,
      description: field.description,
    })),
    query,
  ).map((entry) => ({
    ...entry,
    ...range,
    kind: 'property',
    insertText:
      (quote ? quoteValue(entry.label, quote) : propertyText(entry.label)) +
      suffix,
    retrigger: true,
  }))
}

function propertyEdit(
  request: CompletionRequest,
  segment: PropertySegment,
): PropertyEdit | undefined {
  const [key, colon] = segment.tokens
  if (key && !['name', 'string'].includes(key.type.label)) return
  if (colon && colon.type.label !== ':') return

  const raw = request.text.slice(segment.from, segment.to)
  const partialKey = raw.trimStart()
  // Acorn loose omits an unterminated string token; recover only that key
  const unparsedKey = !key && partialKey.length > 0
  if (unparsedKey && !UNFINISHED_QUOTED_KEY.test(partialKey)) return

  const from = key?.start ?? (partialKey ? segment.to - partialKey.length : request.offset) // prettier-ignore
  const quote = request.text[from]
  const quoted = quote === "'" || quote === '"'
  const queryStart = from + (quoted ? 1 : 0)
  const queryEnd = Math.min(request.offset, key?.end ?? segment.to)
  const query = request.text.slice(queryStart, queryEnd).replace(/['"]$/, '')

  let to = colon?.end ?? key?.end ?? (partialKey ? segment.to : from)
  while (colon && to < segment.to && /\s/.test(request.text[to]!)) to++
  // Place the caret inside an existing string so its values can open immediately
  if (colon && ["'", '"'].includes(request.text[to]!)) to++

  const suffix = colon ? request.text.slice(key!.end, to) : ': '

  return { from, to, query, quote: quoted ? quote : undefined, suffix }
}

function propertyText(name: string): string {
  return /^[$\p{ID_Start}][$\p{ID_Continue}]*$/u.test(name)
    ? name
    : quoteValue(name, "'")
}

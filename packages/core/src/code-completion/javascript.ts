import { completionWord } from './engine'
import { callContext, suppressIdentifiers } from './javascript-context'
import { analyzeScopes, visibleBindings } from './javascript-scope'
import { parseJavaScript } from './javascript-syntax'
import { fuzzyFilter } from './match'
import type {
  Completion,
  CompletionItem,
  CompletionProvider,
  CompletionRequest,
  SignatureHelp,
} from './types'

type JavaScriptAnalysis = {
  syntax: ReturnType<typeof parseJavaScript>
  scopes: ReturnType<typeof analyzeScopes>
}

type CallHelp = {
  signature?: SignatureHelp
  call?: ReturnType<typeof callContext>
}

/** Creates a cached JavaScript provider with optional host-defined globals. */
export function javascriptCompletions(
  symbols: readonly Completion[] = [],
): CompletionProvider {
  let cachedText: string | undefined
  let analysis: JavaScriptAnalysis
  return (request) => {
    if (!['javascript', 'js'].includes(request.language)) return { items: [] }
    if (request.text !== cachedText) {
      const syntax = parseJavaScript(request.text)
      analysis = { syntax, scopes: analyzeScopes(syntax.root, request.text) }
      cachedText = request.text
    }
    return completeJavaScript(request, symbols, analysis)
  }
}

function completeJavaScript(
  request: CompletionRequest,
  symbols: readonly Completion[],
  { syntax, scopes }: JavaScriptAnalysis,
) {
  const locals = visibleBindings(scopes, request.offset)
  const { call, signature } = configuredCall(
    syntax,
    symbols,
    locals,
    request.offset,
  )
  if (request.trigger === 'selection') return { items: [], signature }
  const values = signature?.params[signature.activeParameter]?.values
  const items = values && call ? argumentValues(request, call.range, values) : undefined // prettier-ignore

  if (items?.length) return { items, signature }
  if (suppressIdentifiers(syntax, scopes.declarations, request.offset))
    return { items: [], signature }

  return { items: identifierCompletions(request, symbols, locals), signature }
}

function configuredCall(
  syntax: JavaScriptAnalysis['syntax'],
  symbols: readonly Completion[],
  locals: Map<string, Completion>,
  offset: number,
): CallHelp {
  const call = callContext(syntax, offset)
  if (!call || locals.has(call.name)) return {}
  const helper = symbols.find(
    (symbol) => symbol.label === call.name && symbol.params,
  )
  if (!helper?.params) return {}
  return {
    call,
    signature: {
      label: helper.label,
      params: helper.params,
      activeParameter: call.argument,
      from: call.from,
    },
  }
}

function identifierCompletions(
  request: CompletionRequest,
  symbols: readonly Completion[],
  locals: Map<string, Completion>,
): CompletionItem[] {
  const word = completionWord(request)
  const before = request.text.slice(0, word.from).trimEnd()
  const isProperty = before.endsWith('.')
  const isDeclaration = /\b(?:const|let|var|function|class)\s*$/.test(before)

  if (isProperty || isDeclaration) return []
  if (!word.query && request.trigger !== 'explicit') return []

  const candidates = [
    ...locals.values(),
    ...symbols.filter((entry) => !locals.has(entry.label)),
  ]

  return fuzzyFilter(candidates, word.query).map((entry) =>
    identifierItem(entry, word, request),
  )
}

function identifierItem(
  entry: Completion,
  range: { from: number; to: number },
  request: CompletionRequest,
): CompletionItem {
  const existingCall = /^\s*\(/.test(request.text.slice(range.to))
  return {
    ...entry,
    from: range.from,
    to: range.to,
    snippet: existingCall ? undefined : entry.snippet,
  }
}

/** Completes a standalone argument, preserving quotes and existing suffixes. */
function argumentValues(
  request: CompletionRequest,
  range: { from: number; to: number },
  values: readonly string[],
): CompletionItem[] | undefined {
  const end = Math.min(range.to, request.text.length)
  const argument = request.text.slice(range.from, end)
  const from = range.from + argument.length - argument.trimStart().length
  const raw = request.text.slice(from, end).trimEnd()
  const quote = raw[0]
  const quoted = quote === "'" || quote === '"'

  if (quoted) return quotedValues(request, from, raw, values)
  if (!/^[\p{ID_Continue}$]*$/u.test(raw)) return

  const query = request.text.slice(from, request.offset)

  return fuzzyFilter(
    values.map((label) => ({ label })),
    query,
  ).map((entry) => ({
    ...entry,
    kind: 'value',
    from,
    to: from + raw.length,
    insertText: quoteValue(entry.label, "'"),
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

function quoteValue(value: string, quote: string): string {
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

import { completionWord } from './engine'
import { argumentCompletions, configuredArgument } from './javascript-arguments'
import { suppressIdentifiers } from './javascript-context'
import { analyzeScopes, visibleBindings } from './javascript-scope'
import { parseJavaScript } from './javascript-syntax'
import { fuzzyFilter } from './match'
import type {
  Completion,
  CompletionItem,
  CompletionProvider,
  CompletionRequest,
} from './types'

type JavaScriptAnalysis = {
  syntax: ReturnType<typeof parseJavaScript>
  scopes: ReturnType<typeof analyzeScopes>
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
  const { target, signature } = configuredArgument(
    request,
    syntax,
    symbols,
    locals,
  )
  if (request.trigger === 'selection') return { items: [], signature }

  const inComment = syntax.comments.some(
    (comment) =>
      comment.start < request.offset && request.offset <= comment.end,
  )
  if (inComment) return { items: [], signature }

  const items = target ? argumentCompletions(request, target) : undefined
  if (items !== undefined) return { items, signature }

  if (suppressIdentifiers(syntax, scopes.declarations, request.offset))
    return { items: [], signature }
  return { items: identifierCompletions(request, symbols, locals), signature }
}

function identifierCompletions(
  request: CompletionRequest,
  symbols: readonly Completion[],
  locals: Map<string, Completion>,
): CompletionItem[] {
  const word = completionWord(request)
  const before = request.text.slice(0, word.from).trimEnd()
  const isProperty = before.endsWith('.') && !before.endsWith('...')
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

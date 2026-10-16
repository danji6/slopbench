import { fuzzyFilter } from './match'
import type {
  CompletionItem,
  CompletionProvider,
  CompletionRequest,
  CompletionResult,
  CompletionSource,
} from './types'

const WORD_BEFORE = /[\p{ID_Continue}$\u200c\u200d]+$/u
const WORD_AFTER = /^[\p{ID_Continue}$\u200c\u200d]+/u

/** Finds the entire identifier at the caret, including its untyped suffix. */
export function completionWord({ text, offset }: CompletionRequest) {
  const query = text.slice(0, offset).match(WORD_BEFORE)?.[0] ?? ''
  const suffix = text.slice(offset).match(WORD_AFTER)?.[0] ?? ''
  return { from: offset - query.length, to: offset + suffix.length, query }
}

/** Adapts static entries to the context-aware provider interface. */
export function staticCompletions(
  source: CompletionSource,
): CompletionProvider {
  if (typeof source === 'function') return source
  return (request) => {
    const word = completionWord(request)
    if (!word.query && request.trigger !== 'explicit') return { items: [] }
    return {
      items: fuzzyFilter([...source], word.query).map((item) => ({
        ...item,
        from: word.from,
        to: word.to,
      })),
    }
  }
}

/** Runs independent providers, isolating failures and duplicate edits. */
export async function collectCompletions(
  providers: readonly CompletionProvider[],
  request: CompletionRequest,
): Promise<CompletionResult> {
  const results = await Promise.allSettled(
    providers.map((provider) =>
      Promise.resolve().then(() => provider(request)),
    ),
  )

  const items: CompletionItem[] = []
  const seen = new Set<string>()
  let signature: CompletionResult['signature']
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    signature ??= result.value.signature
    for (const item of result.value.items) {
      if (!isUsableRange(item, request.text.length)) continue
      const key = JSON.stringify([
        item.from,
        item.to,
        item.snippet ?? item.insertText ?? item.label,
        item.snippet !== undefined,
      ])
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
  }

  return { items, signature }
}

function isUsableRange(item: CompletionItem, length: number): boolean {
  return (
    Number.isInteger(item.from) &&
    Number.isInteger(item.to) &&
    item.from >= 0 &&
    item.to >= item.from &&
    item.to <= length
  )
}

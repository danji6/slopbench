import {
  collectCompletions,
  staticCompletions,
} from '@sb/core/code-completion/engine'
import type {
  CompletionProvider,
  CompletionSource,
} from '@sb/core/code-completion/types'

/** Loads JavaScript analysis on demand, retaining one cache per editor source. */
export function javascriptSource(
  source?: CompletionSource,
): CompletionProvider {
  const symbols = Array.isArray(source) ? source : []
  const extra = typeof source === 'function' ? [staticCompletions(source)] : []
  let provider: Promise<CompletionProvider> | undefined

  return async (request) => {
    provider ??= import('@sb/core/code-completion/javascript')
      .then((module) => module.javascriptCompletions(symbols))
      .catch((error) => {
        provider = undefined
        throw error
      })
    return collectCompletions([await provider, ...extra], request)
  }
}

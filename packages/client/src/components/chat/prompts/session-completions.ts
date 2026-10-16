import type { CompletionDocumentSource } from '@/lib/completion/document'
import { collectDocText, offsetAt } from '@/lib/tiptap/interpreter-doc'
import { isInCodeContext } from '@/lib/tiptap/interpreter-syntax'
import { staticCompletions } from '@sb/core/code-completion/engine'
import type {
  Completion,
  CompletionProvider,
} from '@sb/core/code-completion/types'
import { SESSION_ENV, isEnvFunction } from '@sb/core/interpreter/env'

const SESSION_COMPLETIONS: Completion[] = SESSION_ENV.map((entry) => ({
  label: entry.name,
  detail: isEnvFunction(entry) ? 'function' : 'variable',
  description: entry.description,
  snippet: entry.snippet,
  params: entry.params,
}))
const environmentProvider = staticCompletions(SESSION_COMPLETIONS)

/** Offers session names only within the prompt interpreter's code regions. */
export const sessionCompletionSource: CompletionProvider = (request) => {
  if (!isInCodeContext(request.text, request.offset)) return { items: [] }
  if (request.trigger === 'selection') return { items: [] }
  return environmentProvider(request)
}

/** Maps prompt text across paragraphs, excluding fenced code blocks. */
export const promptCompletionDocument: CompletionDocumentSource = (editor) => {
  const { $from, empty, from } = editor.state.selection
  if (
    !empty ||
    !$from.parent.isTextblock ||
    $from.parent.type.name === 'codeBlock'
  ) {
    return null
  }

  const map = collectDocText(editor.state.doc)
  const offset = offsetAt(map, from)

  return {
    text: map.text,
    offset,
    toDocument: (position, edge) => {
      if (position === offset) return from
      if (edge === 'end' && position > 0) {
        const previous = map.positions[position - 1]
        return previous === undefined ? null : previous + 1
      }
      return map.positions[position] ?? null
    },
  }
}

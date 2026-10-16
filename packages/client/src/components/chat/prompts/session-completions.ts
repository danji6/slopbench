import type { CompletionDocumentSource } from '@/lib/completion/document'
import { javascriptSource } from '@/lib/completion/javascript-source'
import { collectDocText, offsetAt } from '@/lib/tiptap/interpreter-doc'
import { interpreterCodeRange } from '@/lib/tiptap/interpreter-syntax'
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
const environmentProvider = javascriptSource(SESSION_COMPLETIONS)

/** Completes JavaScript within one interpreter region, preserving prompt offsets. */
export const sessionCompletionSource: CompletionProvider = async (request) => {
  const range = interpreterCodeRange(request.text, request.offset)
  if (!range) return { items: [] }
  const result = await environmentProvider({
    ...request,
    text: request.text.slice(range.from, range.to),
    offset: request.offset - range.from,
  })
  return {
    items: result.items.map((item) => ({
      ...item,
      from: item.from + range.from,
      to: item.to + range.from,
    })),
    signature: result.signature && {
      ...result.signature,
      from: result.signature.from + range.from,
    },
  }
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

import type { Completion } from '@/components/ui/code-completion'
import { fuzzyFilter } from '@/lib/completion-match'
import { collectDocText, offsetAt } from '@/lib/tiptap/interpreter-doc'
import { isInCodeContext } from '@/lib/tiptap/interpreter-syntax'
import { SESSION_ENV, isEnvFunction } from '@sb/core/interpreter/env'
import type { Editor } from '@tiptap/react'

/** Session env entries offered while typing inside a dynamic block. */
const SESSION_COMPLETIONS: Completion[] = SESSION_ENV.map((entry) => ({
  label: entry.name,
  detail: isEnvFunction(entry) ? 'function' : 'variable',
  snippet: entry.snippet,
}))

/** Session env completions for the prompt editor. */
export function sessionCompletionSource(editor: Editor | null) {
  return (query: string): Completion[] => {
    if (!editor || editor.state.selection.empty === false) return []
    const { $from } = editor.state.selection
    const parent = $from.parent
    if (!parent.isTextblock || parent.type.name === 'codeBlock') return []

    const map = collectDocText(editor.state.doc)
    if (!isInCodeContext(map.text, offsetAt(map, $from.pos))) return []

    return fuzzyFilter(SESSION_COMPLETIONS, query)
  }
}

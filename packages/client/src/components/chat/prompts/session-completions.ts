import type { Completion } from '@/components/ui/code-completion'
import { DYNAMIC_LANG } from '@/lib/tiptap/extensions/dynamic-block'
import { SESSION_ENV } from '@sb/core/interpreter/env'
import type { Editor } from '@tiptap/react'

/** Session env entries offered while typing inside a dynamic block. */
const SESSION_COMPLETIONS: Completion[] = SESSION_ENV.map((entry) => ({
  label: entry.name,
  detail: entry.kind,
  snippet: entry.snippet,
}))

/** Session env completions for the prompt editor. */
export function sessionCompletionSource(editor: Editor | null) {
  return (query: string): Completion[] => {
    if (!editor || editor.state.selection.empty === false) return []
    const { parent } = editor.state.selection.$from
    if (
      parent.type.name !== 'codeBlock' ||
      parent.attrs.language !== DYNAMIC_LANG
    )
      return []

    const q = query.toLowerCase()
    return q
      ? SESSION_COMPLETIONS.filter((c) => c.label.toLowerCase().includes(q))
      : SESSION_COMPLETIONS
  }
}

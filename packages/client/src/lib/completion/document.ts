import type { Editor } from '@tiptap/react'

export type CompletionDocument = {
  text: string
  offset: number
  toDocument: (offset: number, edge: 'start' | 'end') => number | null
}

export type CompletionDocumentSource = (
  editor: Editor,
) => CompletionDocument | null

/** Maps a single code block's text offsets to editor positions. */
export const codeCompletionDocument: CompletionDocumentSource = (editor) => {
  const { $from, empty } = editor.state.selection
  if (!empty || !$from.parent.isTextblock) return null
  const start = $from.start()
  return {
    text: $from.parent.textContent,
    offset: $from.parentOffset,
    toDocument: (offset) => start + offset,
  }
}

import type { JSONContent } from '@tiptap/core'

/** Imperative access to an editor's document. */
export type EditorDocumentHandle = {
  /** Read the document's content. */
  read: () => JSONContent | undefined
}

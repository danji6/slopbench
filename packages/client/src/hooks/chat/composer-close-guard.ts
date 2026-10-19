import { installCloseGuard } from '@/lib/close-guard'
import type { Editor } from '@tiptap/react'
import { type RefObject, useEffect } from 'react'

/** Protects active composer input without blocking reloads for saved drafts. */
export function useComposerCloseGuard(editorRef: RefObject<Editor | null>) {
  useEffect(
    () =>
      installCloseGuard(() => {
        const editor = editorRef.current
        if (!editor || editor.isDestroyed || !editor.isFocused) return false
        return editor.state.doc.textContent.trim().length > 0
      }),
    [editorRef],
  )
}

import { Placeholder } from '@tiptap/extension-placeholder'
import type { Editor } from '@tiptap/react'
import { useCallback, useEffect, useMemo, useRef } from 'react'

const PLACEHOLDER_UPDATE_META = 'composerPlaceholderUpdate'

export function usePlaceholder(placeholder?: string) {
  const editorRef = useRef<Editor | null>(null)
  const placeholderRef = useRef(placeholder ?? '')

  useEffect(() => {
    placeholderRef.current = placeholder ?? ''
    refreshPlaceholder(editorRef.current)
  }, [placeholder])

  const extension = useMemo(
    () =>
      // ProseMirror calls this during its decoration pass, outside React render
      // eslint-disable-next-line react-hooks/refs
      Placeholder.configure({
        placeholder: () => placeholderRef.current,
      }),
    [],
  )

  const setEditor = useCallback((editor: Editor | null) => {
    editorRef.current = editor
    refreshPlaceholder(editor)
  }, [])

  return useMemo(() => ({ extension, setEditor }), [extension, setEditor])
}

function refreshPlaceholder(editor: Editor | null) {
  if (!editor || editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setMeta(PLACEHOLDER_UPDATE_META, true))
}

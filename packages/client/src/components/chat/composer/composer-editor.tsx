import { fullscreenGrow } from '@/components/ui'
import { isCovered } from '@/lib/focus-return'
import { MentionDecoration } from '@/lib/tiptap/decorations/mention'
import { editorKit } from '@/lib/tiptap/kit'
import { cn } from '@/lib/utils'
import type { EditorView } from '@tiptap/pm/view'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { useEffect, useMemo, useRef } from 'react'

import { usePlaceholder } from './use-placeholder'

export type ComposerEditorProps = {
  placeholder?: string
  autoFocus?: boolean
  editorClassName?: string
  onReady?: (editor: Editor) => void
  /** ProseMirror keydown hook. Return true to stop default handling. */
  handleKeyDown?: (view: EditorView, event: KeyboardEvent) => boolean
  /** ProseMirror paste hook. Return true to suppress default paste. */
  handlePaste?: (view: EditorView, event: ClipboardEvent) => boolean
}

export function ComposerEditor({
  placeholder,
  autoFocus = true,
  editorClassName,
  onReady,
  handleKeyDown,
  handlePaste,
}: ComposerEditorProps) {
  const handleKeyDownRef = useRef(handleKeyDown)
  const handlePasteRef = useRef(handlePaste)
  const { extension: placeholderExtension, setEditor: setPlaceholderEditor } =
    usePlaceholder(placeholder)

  useEffect(() => {
    handleKeyDownRef.current = handleKeyDown
    handlePasteRef.current = handlePaste
  })

  const extensions = useMemo(
    () => [
      ...editorKit({ debounce: 60, collapseBlocks: true }),
      MentionDecoration,
      placeholderExtension,
    ],
    [placeholderExtension],
  )

  const editor = useEditor({
    extensions,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        'data-slot': 'editor',
        class: cn(
          'min-h-9 group-data-[fullscreen]/fullscreen:min-h-full',
          editorClassName,
        ),
      },
      handleKeyDown: (view, event) =>
        handleKeyDownRef.current?.(view, event) ?? false,
      handlePaste: (view, event) =>
        handlePasteRef.current?.(view, event) ?? false,
    },
  })

  useEffect(() => {
    setPlaceholderEditor(editor)
    return () => setPlaceholderEditor(null)
  }, [editor, setPlaceholderEditor])

  useEffect(() => {
    if (!editor) return
    // Focus only if not covered by a modal
    if (autoFocus && !isCovered(editor.view.dom)) {
      editor.view.dom.focus({ preventScroll: true })
      editor.commands.focus('end', { scrollIntoView: false })
    }
    onReady?.(editor)
    // onReady is intentionally excluded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  return (
    <div data-slot="editor-container" className={fullscreenGrow}>
      <EditorContent className={fullscreenGrow} editor={editor} />
    </div>
  )
}

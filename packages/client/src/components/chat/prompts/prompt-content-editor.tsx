import {
  FullscreenEditor,
  codeEditorVariants,
  fullscreenFill,
} from '@/components/ui'
import { useCodeCompletion } from '@/components/ui/code-completion'
import { useEditorBaseline } from '@/hooks/editor-baseline'
import { handleSelectAllDelete } from '@/lib/editor-clear'
import { InterpreterHighlight } from '@/lib/tiptap/decorations'
import { InterpreterInput } from '@/lib/tiptap/extensions/interpreter-input'
import { SnippetStops } from '@/lib/tiptap/extensions/snippet-stops'
import type { EditorDocumentHandle } from '@/lib/tiptap/handle'
import { editorKit } from '@/lib/tiptap/kit'
import { pasteTextLines } from '@/lib/tiptap/paste'
import {
  parseEditorMarkdown,
  serializeDocumentToMarkdown,
} from '@/lib/tiptap/serialize'
import { cn } from '@/lib/utils'
import type { JSONContent } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { useEffect, useImperativeHandle, useRef } from 'react'

import { sessionCompletionSource } from './session-completions'

export type PromptContentEditorProps = {
  value: string
  onChange: (value: string) => void
  /**
   * Document to open on in place of parsing `value`, for content restored from
   * a draft.
   */
  doc?: JSONContent
  /**
   * Receives `value` as the editor itself serializes it, always before the
   * first `onChange`. See {@link useEditorBaseline}.
   */
  onBaseline?: (markdown: string) => void
  /** Stable id identifying this editor while in fullscreen. */
  fullscreenId: string
  placeholder?: string
  autoFocus?: boolean
  className?: string
  ref?: React.Ref<EditorDocumentHandle>
}

/** Markdown editor for agent prompts. */
export function PromptContentEditor({
  value,
  onChange,
  doc,
  onBaseline,
  fullscreenId,
  placeholder,
  autoFocus = false,
  className,
  ref,
}: PromptContentEditorProps) {
  const onChangeRef = useRef(onChange)
  const editorRef = useRef<Editor | null>(null)
  const baseline = useEditorBaseline(onBaseline)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  const editor = useEditor({
    extensions: [
      ...editorKit({ placeholder, debounce: 60 }),
      SnippetStops,
      InterpreterInput,
      InterpreterHighlight,
    ],
    content: doc ?? value,
    contentType: 'markdown',
    immediatelyRender: false,
    autofocus: autoFocus ? 'end' : false,
    onTransaction({ editor: e, transaction }) {
      baseline(e, transaction.before)
    },
    onCreate({ editor: e }) {
      baseline(e)
    },
    onUpdate({ editor: e }) {
      onChangeRef.current(serializeDocumentToMarkdown(e))
    },
    editorProps: {
      attributes: {
        'data-slot': 'editor',
        class: cn('min-h-full p-4', className),
      },
      handleKeyDown: handleSelectAllDelete,
      handlePaste: (_view, event) =>
        editorRef.current ? pasteTextLines(editorRef.current, event) : false,
    },
  })

  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  useImperativeHandle(ref, () => ({ read: () => editor?.getJSON() }), [editor])

  // A document that arrives after the editor did, restored into it
  const opened = useRef(doc)
  useEffect(() => {
    if (!editor || !doc || opened.current === doc) return
    opened.current = doc
    editor.commands.setContent(doc, { emitUpdate: false })
  }, [editor, doc])

  // Resync when the value changes from outside while unfocused
  useEffect(() => {
    if (!editor || editor.isFocused) return
    if (value === serializeDocumentToMarkdown(editor)) return
    editor.commands.setContent(parseEditorMarkdown(editor, value), {
      emitUpdate: false,
    })
  }, [editor, value])

  const completionPopup = useCodeCompletion(
    editor,
    sessionCompletionSource(editor),
  )

  return (
    <FullscreenEditor id={fullscreenId}>
      <div
        data-slot="editor-container"
        className={cn(
          codeEditorVariants({ variant: 'default' }),
          className,
          fullscreenFill,
        )}
      >
        <FullscreenEditor.Toolbar />
        <EditorContent
          className="min-h-0 flex-1 pr-6! [&_p]:mt-0! [&_p+p]:mt-7!"
          editor={editor}
        />
        {completionPopup}
      </div>
    </FullscreenEditor>
  )
}

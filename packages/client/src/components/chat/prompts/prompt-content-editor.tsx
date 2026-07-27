import {
  FullscreenEditor,
  codeEditorVariants,
  fullscreenFill,
} from '@/components/ui'
import { CodeBlockShiki } from '@/components/ui/code-block-shiki'
import { useCodeCompletion } from '@/components/ui/code-completion'
import { handleSelectAllDelete } from '@/lib/editor-clear'
import { getHighlighter } from '@/lib/shiki/core'
import { theme, themeName } from '@/lib/shiki/theme'
import { InterpreterHighlight } from '@/lib/tiptap/decorations'
import { CodeEdit } from '@/lib/tiptap/extensions/code-edit'
import { InterpreterInput } from '@/lib/tiptap/extensions/interpreter-input'
import { LineBreaks } from '@/lib/tiptap/extensions/line-breaks'
import { Markdown } from '@/lib/tiptap/extensions/markdown'
import { RevealInsert } from '@/lib/tiptap/extensions/reveal-insert'
import { SnippetStops } from '@/lib/tiptap/extensions/snippet-stops'
import { copyBlockText, pasteTextLines } from '@/lib/tiptap/paste'
import { serializeDocumentToMarkdown } from '@/lib/tiptap/serialize'
import { cn } from '@/lib/utils'
import { Placeholder } from '@tiptap/extension-placeholder'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { useEffect, useRef } from 'react'

import { sessionCompletionSource } from './session-completions'

export type PromptContentEditorProps = {
  value: string
  onChange: (value: string) => void
  /** Stable id identifying this editor while in fullscreen. */
  fullscreenId: string
  placeholder?: string
  autoFocus?: boolean
  className?: string
}

/** Markdown editor for agent prompts. */
export function PromptContentEditor({
  value,
  onChange,
  fullscreenId,
  placeholder,
  autoFocus = false,
  className,
}: PromptContentEditorProps) {
  const onChangeRef = useRef(onChange)
  const editorRef = useRef<Editor | null>(null)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlockShiki.configure({
        themes: { light: themeName, dark: themeName },
        customThemes: [theme],
        highlighter: getHighlighter(),
        lineNumbers: true,
        debounce: 60,
      }),
      Markdown,
      CodeEdit,
      RevealInsert,
      LineBreaks,
      SnippetStops,
      InterpreterInput,
      InterpreterHighlight,
      ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
    ],
    content: value,
    contentType: 'markdown',
    immediatelyRender: false,
    autofocus: autoFocus ? 'end' : false,
    onUpdate({ editor: e }) {
      onChangeRef.current(serializeDocumentToMarkdown(e))
    },
    editorProps: {
      attributes: {
        'data-slot': 'editor',
        class: cn('min-h-full p-4', className),
      },
      handleKeyDown: handleSelectAllDelete,
      clipboardTextSerializer: copyBlockText,
      handlePaste: (_view, event) =>
        editorRef.current ? pasteTextLines(editorRef.current, event) : false,
    },
  })

  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  // Resync when the value changes from outside while unfocused
  useEffect(() => {
    if (!editor || editor.isFocused) return
    if (value === serializeDocumentToMarkdown(editor)) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const manager = (editor.storage.markdown as any).manager
    editor.commands.setContent(manager.parse(value), { emitUpdate: false })
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

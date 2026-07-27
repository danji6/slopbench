import {
  FullscreenEditor,
  codeEditorVariants,
  fullscreenFill,
} from '@/components/ui'
import { CodeBlockShiki } from '@/components/ui/code-block-shiki'
import { useMathMode } from '@/hooks/chat'
import { normalizeMathDelimiters } from '@/lib/markdown/helpers'
import { getHighlighter } from '@/lib/shiki/core'
import { theme, themeName } from '@/lib/shiki/theme'
import { MathDecoration, setEditorMathMode } from '@/lib/tiptap/decorations'
import { CodeEdit } from '@/lib/tiptap/extensions/code-edit'
import { Markdown } from '@/lib/tiptap/extensions/markdown'
import { MarkdownMath } from '@/lib/tiptap/extensions/markdown-math'
import { RevealInsert } from '@/lib/tiptap/extensions/reveal-insert'
import { serializeDocumentToMarkdown } from '@/lib/tiptap/serialize'
import { cn } from '@/lib/utils'
import { Table } from '@tiptap/extension-table'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableRow } from '@tiptap/extension-table-row'
import { EditorContent, useEditor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { useEffect, useRef } from 'react'

export type PlanEditorProps = {
  /** Markdown the editor opens with. */
  initialMarkdown: string
  onChange: (markdown: string) => void
  /** Called on the save shortcut. */
  onSave?: () => void
  /** Stable id identifying this editor while in fullscreen. */
  fullscreenId: string
  /** Extra controls, rendered in the editor's toolbar. */
  toolbar?: React.ReactNode
}

/** Markdown editor for session plans. */
export function PlanEditor({
  initialMarkdown,
  onChange,
  onSave,
  fullscreenId,
  toolbar,
}: PlanEditorProps) {
  const mathMode = useMathMode()
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)

  useEffect(() => {
    onChangeRef.current = onChange
    onSaveRef.current = onSave
  })

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlockShiki.configure({
        themes: { light: themeName, dark: themeName },
        customThemes: [theme],
        highlighter: getHighlighter(),
        lineNumbers: true,
      }),
      Markdown,
      MarkdownMath,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      MathDecoration.configure({ mathMode }),
      CodeEdit,
      RevealInsert,
    ],
    content:
      mathMode === 'off'
        ? initialMarkdown
        : normalizeMathDelimiters(initialMarkdown),
    contentType: 'markdown',
    immediatelyRender: false,
    onUpdate({ editor: e }) {
      onChangeRef.current(serializeDocumentToMarkdown(e))
    },
    editorProps: {
      attributes: {
        'data-slot': 'editor',
        class: 'min-h-full p-4',
      },
      handleKeyDown: (_view, event) => {
        const save =
          event.key.toLowerCase() === 's' && (event.metaKey || event.ctrlKey)
        if (!save || !onSaveRef.current) return false
        event.preventDefault()
        onSaveRef.current()
        return true
      },
    },
  })

  // Dispatch later changes to the editor
  useEffect(() => {
    if (editor) setEditorMathMode(editor, mathMode)
  }, [editor, mathMode])

  return (
    <FullscreenEditor id={fullscreenId}>
      <div
        data-slot="editor-container"
        className={cn(
          codeEditorVariants({ variant: 'default' }),
          fullscreenFill,
        )}
      >
        <FullscreenEditor.Toolbar>{toolbar}</FullscreenEditor.Toolbar>
        <EditorContent className="min-h-0 flex-1" editor={editor} />
      </div>
    </FullscreenEditor>
  )
}

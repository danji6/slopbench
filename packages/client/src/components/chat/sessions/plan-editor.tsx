import {
  EditorScrollArea,
  FullscreenEditor,
  codeEditorVariants,
  fullscreenFill,
} from '@/components/ui'
import { useMathMode } from '@/hooks/chat'
import { useEditorBaseline } from '@/hooks/editor-baseline'
import type { MathMode } from '@/lib/chat'
import { normalizeMathDelimiters } from '@/lib/markdown/helpers'
import { setEditorMathMode } from '@/lib/tiptap/decorations'
import { editorKit } from '@/lib/tiptap/kit'
import {
  serializeDocumentToMarkdown,
  setEditorMarkdown,
} from '@/lib/tiptap/serialize'
import { cn } from '@/lib/utils'
import type { JSONContent } from '@tiptap/core'
import { useEditor } from '@tiptap/react'
import { useEffect, useImperativeHandle, useRef } from 'react'

/**
 * What the editor holds, in both the forms it is needed in: markdown to save
 * (potentially different after formatting), and the document to reopen.
 */
export type PlanSnapshot = {
  markdown: string
  doc: JSONContent
}

/** Imperative access to the plan editor's document. */
export type PlanEditorHandle = {
  /** Replaces the document's content. */
  write: (content: string | JSONContent) => void
}

export type PlanEditorProps = {
  /** Markdown the editor opens with, or a document to reopen. */
  initialContent: string | JSONContent
  onChange: (snapshot: PlanSnapshot) => void
  /**
   * Receives `initialContent` as the editor itself serializes it, always
   * before the first `onChange` (before the initial format happens).
   */
  onBaseline?: (markdown: string) => void
  /** Called on the save shortcut. */
  onSave?: () => void
  /** Stable id identifying this editor while in fullscreen. */
  fullscreenId: string
  /** Extra controls, rendered in the editor's toolbar. */
  toolbar?: React.ReactNode
  ref?: React.Ref<PlanEditorHandle>
}

/** Markdown editor for session plans. */
export function PlanEditor({
  initialContent,
  onChange,
  onBaseline,
  onSave,
  fullscreenId,
  toolbar,
  ref,
}: PlanEditorProps) {
  const mathMode = useMathMode()
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const baseline = useEditorBaseline(onBaseline)

  useEffect(() => {
    onChangeRef.current = onChange
    onSaveRef.current = onSave
  })

  const editor = useEditor({
    extensions: editorKit({ math: mathMode, tables: true }),
    content: forEditor(initialContent, mathMode),
    contentType: 'markdown',
    immediatelyRender: false,
    onTransaction({ editor: e, transaction }) {
      baseline(e, transaction.before)
    },
    onCreate({ editor: e }) {
      baseline(e)
    },
    onUpdate({ editor: e }) {
      onChangeRef.current({
        markdown: serializeDocumentToMarkdown(e),
        doc: e.getJSON(),
      })
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

  useImperativeHandle(
    ref,
    () => ({
      write: (content) => {
        if (!editor) return
        const next = forEditor(content, mathMode)
        if (typeof next === 'string') setEditorMarkdown(editor, next)
        else editor.commands.setContent(next)
      },
    }),
    [editor, mathMode],
  )

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
        <EditorScrollArea editor={editor} />
      </div>
    </FullscreenEditor>
  )
}

function forEditor(
  content: string | JSONContent,
  mathMode: MathMode,
): string | JSONContent {
  return typeof content !== 'string' || mathMode === 'off'
    ? content
    : normalizeMathDelimiters(content)
}

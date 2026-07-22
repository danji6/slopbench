import { CodeBlockShiki } from '@/components/ui/code-block-shiki'
import { useMathMode } from '@/hooks/chat'
import { normalizeMathDelimiters } from '@/lib/markdown/helpers'
import { getHighlighter } from '@/lib/shiki/core'
import { theme, themeName } from '@/lib/shiki/theme'
import {
  MathDecoration,
  MentionDecoration,
  QuotedTextDecoration,
  setEditorMathMode,
} from '@/lib/tiptap/decorations'
import { CodeEdit } from '@/lib/tiptap/extensions/code-edit'
import { Markdown } from '@/lib/tiptap/extensions/markdown'
import { MarkdownMath } from '@/lib/tiptap/extensions/markdown-math'
import { serializeDocumentToMarkdown } from '@/lib/tiptap/serialize'
import { cn } from '@/lib/utils'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Table } from '@tiptap/extension-table'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableRow } from '@tiptap/extension-table-row'
import type { EditorView } from '@tiptap/pm/view'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { useEffect, useRef } from 'react'

import type { EditCaret, PendingSelection } from './message-edit-context'

export type RichTextEditorProps = {
  initialMarkdown: string
  onChange: (markdown: string) => void
  onSave?: () => void
  onCancel?: () => void
  pendingSelection?: PendingSelection | null
  onReady?: (editor: Editor) => void
  /** Placeholder shown when the editor is empty. */
  placeholder?: string
  /** Focus the editor on mount. Defaults to true (edit mode). */
  autoFocus?: boolean
  /** Extra class applied to the contenteditable element. */
  editorClassName?: string
  /** ProseMirror keydown hook. Return true to stop default handling. */
  handleKeyDown?: (view: EditorView, event: KeyboardEvent) => boolean
  /** ProseMirror paste hook. Return true to suppress default paste. */
  handlePaste?: (view: EditorView, event: ClipboardEvent) => boolean
}

export function RichTextEditor({
  initialMarkdown,
  onChange,
  onSave,
  onCancel,
  pendingSelection,
  onReady,
  placeholder,
  autoFocus = true,
  editorClassName,
  handleKeyDown,
  handlePaste,
}: RichTextEditorProps) {
  const mathMode = useMathMode()
  const content =
    mathMode === 'off'
      ? initialMarkdown
      : normalizeMathDelimiters(initialMarkdown)
  const editorRef = useRef<Editor | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const handleKeyDownRef = useRef(handleKeyDown)
  const handlePasteRef = useRef(handlePaste)

  useEffect(() => {
    onChangeRef.current = onChange
    onSaveRef.current = onSave
    handleKeyDownRef.current = handleKeyDown
    handlePasteRef.current = handlePaste
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
      QuotedTextDecoration,
      MentionDecoration,
      MathDecoration.configure({ mathMode }),
      CodeEdit,
      ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
    ],
    content,
    contentType: 'markdown',
    immediatelyRender: false,
    onUpdate({ editor: e }) {
      onChange(serializeDocumentToMarkdown(e))
    },
    editorProps: {
      attributes: {
        'data-slot': 'editor',
        class: cn('min-h-20', editorClassName),
      },
      handleKeyDown: (view, event) => {
        if (
          onSaveRef.current &&
          event.key.toLowerCase() === 's' &&
          (event.metaKey || event.ctrlKey)
        ) {
          event.preventDefault()
          onChangeRef.current(readMarkdown(editorRef.current))
          onSaveRef.current()
          return true
        }
        return handleKeyDownRef.current?.(view, event) ?? false
      },
      handlePaste: (view, event) =>
        handlePasteRef.current?.(view, event) ?? false,
    },
  })

  useEffect(() => {
    editorRef.current = editor
    return () => {
      if (editorRef.current === editor) editorRef.current = null
    }
  }, [editor])

  // Dispatch later changes to the editor
  useEffect(() => {
    if (editor) setEditorMathMode(editor, mathMode)
  }, [editor, mathMode])

  useEffect(() => {
    if (!editor) return

    if (pendingSelection) {
      editor.view.dom.focus({ preventScroll: true })
      let placed = false
      if (pendingSelection.text) {
        placed = findAndSelect(
          editor,
          pendingSelection.text,
          pendingSelection.occurrenceIndex,
        )
      }
      if (!placed && pendingSelection.caret) {
        placed = placeEditCaret(editor, pendingSelection.caret)
      }
      if (!placed && pendingSelection.caretOffset != null) {
        placed = placeCaret(editor, pendingSelection.caretOffset)
      }
      if (!placed) {
        editor.commands.selectAll()
      }

      // Refocus in the next tick to preserve selection
      setTimeout(() => {
        if (!editor.isDestroyed) {
          editor.view.dom.focus({ preventScroll: true })
        }
      }, 0)

      pendingSelection.onEditorReady?.(editor)
    } else if (autoFocus) {
      editor.view.dom.focus({ preventScroll: true })
      editor.commands.focus('start', { scrollIntoView: false })
    }

    onReady?.(editor)
    // pendingSelection and onReady are intentionally excluded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  function handleWrapperKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && onCancel) {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <div data-slot="editor-container" onKeyDown={handleWrapperKeyDown}>
      <EditorContent editor={editor} />
    </div>
  )
}

/** Serializes the editor to markdown. */
function readMarkdown(editor: Editor | null | undefined): string {
  return editor ? serializeDocumentToMarkdown(editor) : ''
}

/**
 * Maps each non-whitespace character of the doc to its ProseMirror position,
 * applying the same normalization the rendered markdown uses.
 */
function buildTextPositions(editor: Editor): {
  docText: string
  posMap: number[]
} {
  const { doc } = editor.state
  let docText = ''
  const posMap: number[] = []

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        const char = node.text[i]
        if (!/\s/.test(char)) {
          let normChar = char
          // Undo smart quoting from the markdown renderer
          if (char === '\u2018' || char === '\u2019') normChar = "'"
          else if (char === '\u201C' || char === '\u201D') normChar = '"'
          docText += normChar
          posMap.push(pos + i)
        }
      }
    }
  })

  return { docText, posMap }
}

function placeCaret(editor: Editor, caretOffset: number): boolean {
  const { posMap } = buildTextPositions(editor)
  if (posMap.length === 0) return false
  const idx = Math.max(0, Math.min(caretOffset, posMap.length))
  const pos = idx < posMap.length ? posMap[idx] : posMap[posMap.length - 1] + 1
  editor.chain().setTextSelection(pos).focus().run()
  return true
}

function placeEditCaret(editor: Editor, caret: EditCaret): boolean {
  if (caret.kind === 'text') return placeCaret(editor, caret.offset)
  return placeCodeCaret(editor, caret.blockIndex, caret.offset)
}

function placeCodeCaret(
  editor: Editor,
  blockIndex: number,
  caretOffset: number,
): boolean {
  let index = 0
  const target = { pos: -1, size: 0 }

  editor.state.doc.descendants((node, pos) => {
    if (target.pos !== -1) return false
    if (node.type.name !== 'codeBlock') return
    if (index === blockIndex) {
      target.pos = pos
      target.size = node.content.size
      return false
    }
    index += 1
  })

  if (target.pos === -1) return false
  const offset = Math.max(0, Math.min(caretOffset, target.size))
  editor
    .chain()
    .setTextSelection(target.pos + 1 + offset)
    .focus()
    .run()
  return true
}

function findAndSelect(
  editor: Editor,
  text: string,
  occurrenceIndex: number,
): boolean {
  if (!text) return false
  const normalize = (s: string) =>
    s
      .replace(/\s+/g, '')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')

  const strippedText = normalize(text)
  if (!strippedText) return false

  const { docText, posMap } = buildTextPositions(editor)

  const matches: { from: number; to: number }[] = []
  let searchPos = 0

  while (searchPos < docText.length) {
    const idx = docText.indexOf(strippedText, searchPos)
    if (idx === -1) break
    matches.push({
      from: posMap[idx],
      to: posMap[idx + strippedText.length - 1] + 1,
    })
    searchPos = idx + strippedText.length
  }

  if (matches.length === 0) return false
  const { from, to } = matches[Math.min(occurrenceIndex, matches.length - 1)]
  editor.chain().setTextSelection({ from, to }).focus().run()
  return true
}

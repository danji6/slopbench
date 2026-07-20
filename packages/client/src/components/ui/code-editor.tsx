import { handleSelectAllDelete } from '@/lib/editor-clear'
import { getHighlighter } from '@/lib/shiki/core'
import { theme, themeName } from '@/lib/shiki/theme'
import { CodeEdit } from '@/lib/tiptap/extensions/code-edit'
import { SnippetStops } from '@/lib/tiptap/extensions/snippet-stops'
import { cn } from '@/lib/utils'
import { Node } from '@tiptap/core'
import { Placeholder } from '@tiptap/extension-placeholder'
import type { Editor } from '@tiptap/react'
import { EditorContent, useEditor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { type VariantProps, cva } from 'class-variance-authority'
import type { MouseEvent } from 'react'
import { useEffect, useRef } from 'react'

import { CodeBlockShiki } from './code-block-shiki'
import { type CompletionSource, useCodeCompletion } from './code-completion'

export const codeEditorVariants = cva(
  'border-input bg-m3-surface-container-low flex max-h-full min-h-0 flex-1 cursor-text flex-col overflow-auto rounded-2xl border transition-[color,box-shadow,border]',
  {
    variants: {
      variant: {
        default: null,
        outline:
          'focus-within:border-ring focus-within:ring-ring focus-within:ring-1',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export type CodeEditorProps = VariantProps<typeof codeEditorVariants> & {
  /** Current code, treated as the source of truth. External changes resync. */
  value: string
  onChange: (value: string) => void
  /** Shiki language used for highlighting. Defaults to `javascript`. */
  language?: string
  /** Placeholder shown while empty. Mutually exclusive with `lineNumbers`. */
  placeholder?: string
  /** Show a line-number gutter. */
  lineNumbers?: boolean
  /** Wrapper class (border, sizing, scroll). */
  className?: string
  /** Class applied to the editable element. */
  editorClassName?: string
  autoFocus?: boolean
  /** Tab-completion entries shown while typing a word. */
  completions?: CompletionSource
}

/** A basic code editor with indent support. */
export function CodeEditor({
  value,
  onChange,
  language = 'javascript',
  placeholder,
  lineNumbers = false,
  className,
  editorClassName,
  autoFocus = false,
  variant,
  completions,
}: CodeEditorProps) {
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        document: false,
        codeBlock: false,
        gapcursor: false,
        dropcursor: false,
      }),
      CodeDocument,
      CodeBlockShiki.configure({
        themes: { light: themeName, dark: themeName },
        customThemes: [theme],
        highlighter: getHighlighter(),
        defaultLanguage: language,
        exitOnArrowDown: false,
        exitOnTripleEnter: false,
        debounce: 60,
        lineNumbers,
      }),
      CodeEdit,
      SnippetStops,
      // Mutually exclusive with the gutter (shared pre::before pseudo-element)
      ...(placeholder && !lineNumbers
        ? [Placeholder.configure({ placeholder })]
        : []),
    ],
    content: toDoc(value, language),
    immediatelyRender: false,
    autofocus: autoFocus ? 'end' : false,
    onUpdate({ editor: e }) {
      onChangeRef.current(getCode(e))
    },
    editorProps: {
      attributes: {
        'data-slot': 'code-editor',
        class: cn('size-full min-h-16', editorClassName),
        spellcheck: 'false',
      },
      handleKeyDown: (view, event) =>
        handleSelectAllDelete(view, event, { preserveBlock: true }),
    },
  })

  // Resync when the value changes from outside while unfocused
  useEffect(() => {
    if (!editor || editor.isFocused || value === getCode(editor)) return
    editor.commands.setContent(toDoc(value, language), { emitUpdate: false })
  }, [editor, value, language])

  const completionPopup = useCodeCompletion(editor, completions)

  function focusEditor(event: MouseEvent<HTMLDivElement>) {
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest('[contenteditable="true"]')) return

    editor?.commands.focus('end')
  }

  return (
    <div
      data-slot="code-editor-wrapper"
      className={cn(codeEditorVariants({ variant }), className)}
      onMouseDown={focusEditor}
    >
      <EditorContent className="flex min-h-0 flex-1" editor={editor} />
      {completionPopup}
    </div>
  )
}

/** A document whose only content is a single code block. */
const CodeDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'codeBlock',
})

function toDoc(value: string, language: string) {
  return {
    type: 'doc',
    content: [
      {
        type: 'codeBlock',
        attrs: { language },
        content: value ? [{ type: 'text', text: value }] : [],
      },
    ],
  }
}

function getCode(editor: Editor): string {
  const { doc } = editor.state
  return doc.textBetween(0, doc.content.size, '\n')
}

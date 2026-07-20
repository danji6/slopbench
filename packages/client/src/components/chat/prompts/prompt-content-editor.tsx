import { codeEditorVariants } from '@/components/ui'
import { CodeBlockShiki } from '@/components/ui/code-block-shiki'
import { useCodeCompletion } from '@/components/ui/code-completion'
import { handleSelectAllDelete } from '@/lib/editor-clear'
import { getHighlighter } from '@/lib/shiki/core'
import { theme, themeName } from '@/lib/shiki/theme'
import { CodeEdit } from '@/lib/tiptap/extensions/code-edit'
import {
  DYNAMIC_LANG,
  DynamicBlock,
} from '@/lib/tiptap/extensions/dynamic-block'
import { SnippetStops } from '@/lib/tiptap/extensions/snippet-stops'
import { pasteCollapsedText } from '@/lib/tiptap/paste'
import { serializeBlocksToMarkdown } from '@/lib/tiptap/serialize'
import { cn } from '@/lib/utils'
import type { JSONContent, MarkdownRendererHelpers } from '@tiptap/core'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Markdown } from '@tiptap/markdown'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { useEffect, useRef } from 'react'

import { sessionCompletionSource } from './session-completions'

export type PromptContentEditorProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
}

/** Serializes a dynamic code block to its `$\`\`\`` fenced form. */
const PromptCodeBlock = CodeBlockShiki.extend({
  renderMarkdown(node: JSONContent, h: MarkdownRendererHelpers) {
    const code = h.renderChildren(node.content ?? [])
    const language = node.attrs?.language
    const open = language === DYNAMIC_LANG ? '$```' : `\`\`\`${language || ''}`
    return [open, code, '```'].join('\n')
  },
})

/** Markdown editor for agent prompts. */
export function PromptContentEditor({
  value,
  onChange,
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
      PromptCodeBlock.configure({
        themes: { light: themeName, dark: themeName },
        customThemes: [theme],
        highlighter: getHighlighter(),
        languageAliases: { [DYNAMIC_LANG]: 'javascript' },
        debounce: 60,
      }),
      Markdown,
      CodeEdit,
      SnippetStops,
      DynamicBlock,
      ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
    ],
    content: value,
    contentType: 'markdown',
    immediatelyRender: false,
    autofocus: autoFocus ? 'end' : false,
    onUpdate({ editor: e }) {
      onChangeRef.current(serializeBlocksToMarkdown(e))
    },
    editorProps: {
      attributes: {
        'data-slot': 'editor',
        class: cn('min-h-0 flex-1 p-4', className),
      },
      handleKeyDown: handleSelectAllDelete,
      handlePaste: (_view, event) =>
        editorRef.current
          ? pasteCollapsedText(editorRef.current, event)
          : false,
    },
  })

  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  // Resync when the value changes from outside while unfocused
  useEffect(() => {
    if (!editor || editor.isFocused) return
    if (value === serializeBlocksToMarkdown(editor)) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const manager = (editor.storage.markdown as any).manager
    editor.commands.setContent(manager.parse(value), { emitUpdate: false })
  }, [editor, value])

  const completionPopup = useCodeCompletion(
    editor,
    sessionCompletionSource(editor),
  )

  return (
    <div
      data-slot="editor-container"
      className={cn(codeEditorVariants({ variant: 'default' }), className)}
    >
      <EditorContent
        className="flex min-h-0 flex-1 [&_p]:mt-0!"
        editor={editor}
      />
      {completionPopup}
    </div>
  )
}

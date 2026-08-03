import { CodeBlockShiki } from '@/components/ui/code-block-shiki'
import type { MathMode } from '@/lib/chat'
import { getHighlighter } from '@/lib/shiki/core'
import { theme, themeName } from '@/lib/shiki/theme'
import { HtmlDecoration } from '@/lib/tiptap/decorations/html'
import { MathDecoration } from '@/lib/tiptap/decorations/math'
import { BlockOpeners } from '@/lib/tiptap/extensions/block-openers'
import { CodeEdit } from '@/lib/tiptap/extensions/code-edit'
import { LineBreaks } from '@/lib/tiptap/extensions/line-breaks'
import { Markdown } from '@/lib/tiptap/extensions/markdown'
import { MarkdownClipboard } from '@/lib/tiptap/extensions/markdown-clipboard'
import { MarkdownMath } from '@/lib/tiptap/extensions/markdown-math'
import { RevealInsert } from '@/lib/tiptap/extensions/reveal-insert'
import type { Extensions } from '@tiptap/core'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Table } from '@tiptap/extension-table'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableRow } from '@tiptap/extension-table-row'
import { StarterKit } from '@tiptap/starter-kit'

export type EditorKitOptions = {
  /**
   * Adds math tokenizing and preview. Pass the current mode even when it is
   * `off`, so that switching it later has a plugin to talk to (see
   * `setEditorMathMode`). Omit it entirely for editors without math.
   */
  math?: MathMode
  /** Adds the table node set. */
  tables?: boolean
  /** Static placeholder. Editors with a dynamic one should append their own. */
  placeholder?: string
  /** Highlight delay for code blocks while typing. */
  debounce?: number
  /**
   * Stores a block break as a single newline rather than a blank line, which
   * copied text follows (see `serializeBlocksToMarkdown`).
   */
  collapseBlocks?: boolean
}

/** Shared extensions for every markdown editor. */
export function editorKit({
  math,
  tables,
  placeholder,
  debounce,
  collapseBlocks = false,
}: EditorKitOptions = {}): Extensions {
  return [
    StarterKit.configure({ codeBlock: false }),
    CodeBlockShiki.configure({
      themes: { light: themeName, dark: themeName },
      customThemes: [theme],
      highlighter: getHighlighter(),
      lineNumbers: true,
      ...(debounce == null ? {} : { debounce }),
    }),
    Markdown,
    ...(math
      ? [MarkdownMath, MathDecoration.configure({ mathMode: math })]
      : []),
    ...(tables
      ? [
          Table.configure({ resizable: false }),
          TableRow,
          TableCell,
          TableHeader,
        ]
      : []),
    HtmlDecoration,
    MarkdownClipboard.configure({ collapseBlocks }),
    CodeEdit,
    LineBreaks,
    BlockOpeners,
    RevealInsert,
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
  ]
}

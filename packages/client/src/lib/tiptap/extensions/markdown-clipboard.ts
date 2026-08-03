import { serializeSliceToMarkdown } from '@/lib/tiptap/serialize'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

const clipboardKey = new PluginKey('markdownClipboard')

export type MarkdownClipboardOptions = {
  /** Copy blocks separated by a line break rather than a blank line. */
  collapseBlocks: boolean
}

/**
 * Copies the selection as markdown instead of the plain text ProseMirror would
 * strip it down to, keeping formatting and literal html on the clipboard.
 */
export const MarkdownClipboard = Extension.create<MarkdownClipboardOptions>({
  name: 'markdownClipboard',

  addOptions() {
    return { collapseBlocks: false }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: clipboardKey,
        props: {
          clipboardTextSerializer: (slice) =>
            serializeSliceToMarkdown(this.editor, slice, {
              collapseBlocks: this.options.collapseBlocks,
            }),
        },
      }),
    ]
  },
})

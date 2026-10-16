import { isSourceFormat, parseSourceMark } from '@/lib/tiptap/inline-source'
import { sourceFormatCommand } from '@/lib/tiptap/source-commands'
import type { Mark } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'

/** Keeps StarterKit's inline Markdown editable as source. */
export const LineStarterKit = StarterKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map((extension) => {
      if (extension.type !== 'mark') return extension
      if (!isSourceFormat(extension.name)) return extension
      return sourceMark(extension as Mark)
    })
  },
})

/** Retains native mark schemas for HTML imports and older JSON drafts. */
function sourceMark(extension: Mark): Mark {
  const name = extension.name
  if (!isSourceFormat(name)) return extension
  const suffix = name[0].toUpperCase() + name.slice(1)
  return extension.extend({
    exitable: false,
    parseMarkdown: parseSourceMark,
    addInputRules: () => [],
    addPasteRules: () => [],
    addCommands() {
      return {
        [`set${suffix}`]: () => sourceFormatCommand(name, 'set'),
        [`toggle${suffix}`]: () => sourceFormatCommand(name),
        [`unset${suffix}`]: () => sourceFormatCommand(name, 'unset'),
      }
    },
  })
}

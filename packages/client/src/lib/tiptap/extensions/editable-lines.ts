import { editableMarkdownLines } from '@/lib/tiptap/markdown-lines'
import { Extension } from '@tiptap/core'

/** Gives loaded prose the same editable lines that Enter creates. */
export const EditableLines = Extension.create<{ collapseBlocks: boolean }>({
  name: 'editableLines',
  // The Markdown extension must parse the initial content first
  priority: 50,
  addOptions() {
    return { collapseBlocks: false }
  },
  onBeforeCreate() {
    const manager = this.editor.markdown
    if (!manager) return
    const normalize = (doc: ReturnType<typeof manager.parse>) =>
      editableMarkdownLines(doc, this.options.collapseBlocks)
    const parse = manager.parse.bind(manager)
    manager.parse = (markdown) => normalize(parse(markdown))

    const { content } = this.editor.options
    if (content && typeof content !== 'string' && !Array.isArray(content)) {
      this.editor.options.content = normalize(content)
    }
  },
})

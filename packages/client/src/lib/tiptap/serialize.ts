import type { Editor } from '@tiptap/react'

/**
 * Serializes the editor to markdown with paragraph breaks collapsed
 * into single line breaks.
 */
export function serializeBlocksToMarkdown(editor: Editor): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const manager = (editor.storage.markdown as any).manager
  const blocks: string[] = []
  editor.state.doc.forEach((node) => {
    const markdown: string = manager.serialize({
      type: 'doc',
      content: [node.toJSON()],
    })
    blocks.push(markdown.replace(/\n+$/, ''))
  })
  return blocks.join('\n').trim()
}

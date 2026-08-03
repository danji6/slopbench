import { formatMarkdown, trimLineEnds } from '@/lib/markdown/format'
import type { JSONContent } from '@tiptap/core'
import type { Fragment, Node, Slice } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'

/** Renders a hard break as a newline. */
export const leafText = (node: Node) =>
  node.type.name === 'hardBreak' ? '\n' : ''

type MarkdownManager = {
  parse: (markdown: string) => JSONContent
  serialize: (doc: JSONContent) => string
}

/** The manager the editor's markdown extension parses and serializes with. */
function markdownManager(editor: Editor): MarkdownManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (editor.storage.markdown as any).manager as MarkdownManager
}

/** Markdown for a whole document, with blocks separated by a blank line. */
function renderDocument(editor: Editor, doc: Node): string {
  return markdownManager(editor).serialize(doc.toJSON())
}

/** Markdown for every top-level block, separated by a single line break. */
function renderBlocks(editor: Editor, content: Fragment): string {
  const manager = markdownManager(editor)
  const blocks: string[] = []
  content.forEach((node) => {
    // Trimmed before the trailing breaks go, so that a break at the end of a
    // block doesn't leave the two spaces it serializes as behind
    const markdown = trimLineEnds(
      manager.serialize({ type: 'doc', content: [node.toJSON()] }),
    )
    blocks.push(markdown.replace(/\n+$/, ''))
  })
  return blocks.join('\n')
}

/**
 * Serializes the editor to markdown, preserving the blank lines that separate
 * blocks. Pass `doc` to serialize a document the editor no longer holds.
 */
export function serializeDocumentToMarkdown(
  editor: Editor,
  doc?: Node,
): string {
  return formatMarkdown(renderDocument(editor, doc ?? editor.state.doc))
}

/**
 * Serializes the editor to markdown with paragraph breaks collapsed into
 * single line breaks, so that Enter reads as a newline rather than a blank
 * line. Chat input only, it discards block spacing.
 */
export function serializeBlocksToMarkdown(editor: Editor): string {
  return formatMarkdown(renderBlocks(editor, editor.state.doc.content))
}

export type SliceSerializeOptions = {
  /** Separate blocks with a line break rather than a blank line. */
  collapseBlocks?: boolean
}

/**
 * Serializes a copied selection the way the editor stores its content, so that
 * pasting it anywhere else keeps its markdown and any literal html. Unlike a
 * stored document, the selection keeps the whitespace at its edges.
 */
export function serializeSliceToMarkdown(
  editor: Editor,
  slice: Slice,
  { collapseBlocks }: SliceSerializeOptions = {},
): string {
  const { content } = slice
  if (isWithinCode(slice)) {
    return content.textBetween(0, content.size, '\n', leafText)
  }

  const doc = asDocument(editor, content)
  return trimLineEnds(
    collapseBlocks
      ? renderBlocks(editor, doc.content)
      : renderDocument(editor, doc),
  )
}

/** Whether the selection sits inside a single code block. */
function isWithinCode(slice: Slice): boolean {
  return (
    slice.content.childCount === 1 &&
    slice.openStart > 0 &&
    slice.openEnd > 0 &&
    !!slice.content.firstChild?.type.spec.code
  )
}

/** A copied fragment wrapped back into a document, ready to serialize. */
function asDocument(editor: Editor, content: Fragment): Node {
  const { schema } = editor
  const paragraph = schema.nodes.paragraph
  // A selection within one text block holds inline content on its own
  const wrapped =
    content.firstChild?.isInline && paragraph
      ? paragraph.create(null, content)
      : content
  return schema.topNodeType.create(null, wrapped)
}

/** Parses markdown into a document for the editor's schema. */
export function parseEditorMarkdown(
  editor: Editor,
  markdown: string,
): JSONContent {
  return markdownManager(editor).parse(markdown)
}

/** Replaces the editor content with the given markdown. */
export function setEditorMarkdown(editor: Editor, markdown: string): void {
  const content = markdown ? parseEditorMarkdown(editor, markdown) : ''
  editor.commands.setContent(content)
}

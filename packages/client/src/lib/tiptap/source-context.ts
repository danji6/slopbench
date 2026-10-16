import { type SourceSpan, collectSourceSpans } from '@/lib/tiptap/inline-source'
import type { MarkdownManager } from '@tiptap/markdown'
import type { Node, Schema } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'

type SourceContext = {
  manager: MarkdownManager
  cache: WeakMap<Node, SourceSpan[]>
  documents: WeakMap<Node, SourceSpan[]>
}
const contexts = new WeakMap<Schema, SourceContext>()

/** Shares the configured lexer with domain guards that only receive editor state. */
export function registerSourceManager(
  schema: Schema,
  manager: MarkdownManager,
): void {
  contexts.set(schema, {
    manager,
    cache: new WeakMap(),
    documents: new WeakMap(),
  })
}

/** Finds the source code policy for a shared Markdown editor. */
export function sourceCodeManager(
  state: EditorState,
): MarkdownManager | undefined {
  return contexts.get(state.schema)?.manager
}

/** Shares parsed source spans between previews for the same immutable document. */
export function documentSourceSpans(doc: Node): SourceSpan[] {
  const context = contexts.get(doc.type.schema)
  if (!context) return []
  let spans = context.documents.get(doc)
  if (!spans) {
    spans = collectSourceSpans(doc, context.manager, context.cache)
    context.documents.set(doc, spans)
  }
  return spans
}

/** Finds opaque inline code ranges for other editor decorations. */
export function sourceCodeRanges(doc: Node): SourceSpan[] {
  return documentSourceSpans(doc).filter((span) => span.format === 'code')
}

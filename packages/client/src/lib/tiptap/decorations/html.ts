import { renderSanitizedHtml } from '@/lib/markdown/html'
import { findHtmlSpans, isWholeHtml } from '@/lib/markdown/html-scan'
import { Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import type { Selection } from '@tiptap/pm/state'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

type HtmlPluginState = {
  spans: Span[]
  revealSig: string
  decorations: DecorationSet
}

const htmlKey = new PluginKey<HtmlPluginState>('htmlDecoration')

/** Previews raw HTML in the editor. */
export const HtmlDecoration = Extension.create({
  name: 'htmlDecoration',

  addProseMirrorPlugins() {
    return [
      new Plugin<HtmlPluginState>({
        key: htmlKey,
        state: {
          init: (_, state) => {
            const spans = collectSpans(state.doc)
            return {
              spans,
              revealSig: revealSignature(spans, state.selection),
              decorations: buildDecorations(state.doc, spans, state.selection),
            }
          },
          apply: (tr, prev, _old, state) => {
            if (!tr.docChanged && !tr.selectionSet) return prev

            // Re-walk the doc only when its content changed
            const spans = tr.docChanged ? collectSpans(state.doc) : prev.spans
            const revealSig = revealSignature(spans, state.selection)
            if (!tr.docChanged && revealSig === prev.revealSig) return prev

            return {
              spans,
              revealSig,
              decorations: buildDecorations(state.doc, spans, state.selection),
            }
          },
        },
        props: {
          decorations: (state) => htmlKey.getState(state)?.decorations,
        },
      }),
    ]
  },
})

type Span = { from: number; to: number; html: string; block: boolean }

/** Walks the doc for every HTML span, independent of the current selection. */
function collectSpans(doc: Node): Span[] {
  const spans: Span[] = []

  doc.descendants((node, pos) => {
    // Skip HTML inside code blocks
    if (node.type.spec.code) return false
    if (!node.isBlock || !node.inlineContent) return

    // A block that is entirely one element renders as a block preview
    const text = node.textBetween(0, node.content.size, '\n', '\n')
    if (isWholeHtml(text)) {
      spans.push({
        from: pos + 1,
        to: pos + 1 + node.content.size,
        html: text.trim(),
        block: true,
      })
      return false
    }

    for (const segment of inlineSegments(node, pos)) {
      for (const span of findHtmlSpans(segment.text)) {
        spans.push({
          from: segment.positions[span.start],
          to: segment.positions[span.end],
          html: span.html,
          block: false,
        })
      }
    }

    return false
  })

  return spans
}

type Segment = { text: string; positions: number[] }

/**
 * A block's inline content flattened into scannable runs, each mapping every
 * character back to its position.
 */
function inlineSegments(node: Node, pos: number): Segment[] {
  const segments: Segment[] = []
  let text = ''
  let positions: number[] = []
  let end = 0

  function flush() {
    if (text) segments.push({ text, positions: [...positions, end] })
    text = ''
    positions = []
  }

  node.content.forEach((child, offset) => {
    const from = pos + 1 + offset

    if (child.isText && child.text && !isCode(child)) {
      for (let i = 0; i < child.text.length; i++) positions.push(from + i)
      text += child.text
      end = from + child.text.length
    } else if (child.type.name === 'hardBreak') {
      positions.push(from)
      text += '\n'
      end = from + child.nodeSize
    } else {
      flush()
    }
  })
  flush()

  return segments
}

function isCode(node: Node): boolean {
  return node.marks.some((mark) => mark.type.spec.code)
}

/** A span's source is revealed when the selection is within/adjacent to it. */
function isRevealed(span: Span, selection: Selection): boolean {
  if (selection.from > span.to || selection.to < span.from) return false
  if (selection.from <= span.from && selection.to >= span.to) return false
  return true
}

function revealSignature(spans: Span[], selection: Selection): string {
  let sig = ''
  for (const span of spans) {
    if (isRevealed(span, selection)) sig += `${span.from}:${span.to},`
  }
  return sig
}

function buildDecorations(
  doc: Node,
  spans: Span[],
  selection: Selection,
): DecorationSet {
  const decorations: Decoration[] = []
  for (const span of spans) {
    if (isRevealed(span, selection)) continue
    // Markup that renders to nothing keeps its source, which would otherwise
    // be hidden behind an empty preview
    const html = renderSanitizedHtml(span.html)
    if (!html) continue
    decorations.push(hideSource(span.from, span.to))
    decorations.push(renderWidget(span, html))
  }
  return DecorationSet.create(doc, decorations)
}

function hideSource(from: number, to: number): Decoration {
  return Decoration.inline(from, to, { class: 'html-source' })
}

function renderWidget(span: Span, html: string): Decoration {
  return Decoration.widget(
    span.from,
    (view) => {
      const dom = document.createElement('span')
      dom.className = span.block
        ? 'html-preview html-preview-block'
        : 'html-preview'
      dom.contentEditable = 'false'
      dom.innerHTML = html
      // Clicking the preview drops the caret into the span to edit its source
      dom.addEventListener('mousedown', (event) => {
        event.preventDefault()
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, span.to),
          ),
        )
        view.focus()
      })
      return dom
    },
    { side: -1, key: `${span.from}:${span.html}`, ignoreSelection: true },
  )
}

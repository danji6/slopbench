import type { SourceSpan } from '@/lib/tiptap/inline-source'
import { clearSourceFormatting } from '@/lib/tiptap/source-commands'
import {
  documentSourceSpans,
  registerSourceManager,
} from '@/lib/tiptap/source-context'
import {
  handleSourceBeforeInput,
  handleSourceKey,
} from '@/lib/tiptap/source-input'
import {
  normalizeSourceDocument,
  normalizeSourceMarks,
} from '@/lib/tiptap/source-normalize'
import { Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Selection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

type SourceState = {
  spans: SourceSpan[]
  focused: boolean
  dragging: boolean
  decorations: DecorationSet
}
type SourceMeta = { focused?: boolean; dragging?: boolean }
const sourceKey = new PluginKey<SourceState>('inlineSource')

/** Previews inline Markdown while retaining every editable source character. */
export const InlineSource = Extension.create({
  name: 'inlineSource',
  // Normalize JSON after Markdown and EditableLines have initialized
  priority: 40,

  onBeforeCreate() {
    const manager = this.editor.markdown
    if (manager) registerSourceManager(this.editor.schema, manager)
    const content = this.editor.options.content
    if (content && typeof content !== 'string' && !Array.isArray(content)) {
      this.editor.options.content = normalizeSourceDocument(
        this.editor.schema,
        content,
      )
    }
  },

  addCommands() {
    return { unsetAllMarks: () => clearSourceFormatting }
  },

  addProseMirrorPlugins() {
    const manager = this.editor.markdown
    if (!manager) return []
    return [
      new Plugin<SourceState>({
        key: sourceKey,
        state: {
          init: (_, state) => {
            const spans = documentSourceSpans(state.doc)
            return {
              spans,
              focused: false,
              dragging: false,
              decorations: decorate(state.doc, spans, state.selection, false),
            }
          },
          apply: (tr, prev, _old, state) => {
            const meta = tr.getMeta(sourceKey) as SourceMeta | undefined
            const focused = meta?.focused ?? prev.focused
            const dragging = meta?.dragging ?? prev.dragging
            const displayChanged = focused !== prev.focused || dragging !== prev.dragging // prettier-ignore

            if (!tr.docChanged && !tr.selectionSet && !displayChanged)
              return prev

            const spans = tr.docChanged
              ? documentSourceSpans(state.doc)
              : prev.spans
            // Keep native drag coordinates stable until the mouse is released
            const decorations =
              dragging && !tr.docChanged
                ? prev.decorations
                : decorate(state.doc, spans, state.selection, focused)

            return { spans, focused, dragging, decorations }
          },
        },
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some((tr) => tr.docChanged)) return null
          const tr = state.tr
          return normalizeSourceMarks(tr) ? tr : null
        },
        view: (view) => {
          const finishDrag = () => {
            if (sourceKey.getState(view.state)?.dragging) {
              view.dispatch(
                view.state.tr.setMeta(sourceKey, { dragging: false }),
              )
            }
          }
          const doc = view.dom.ownerDocument

          doc.addEventListener('mouseup', finishDrag)
          doc.addEventListener('dragend', finishDrag)
          return {
            destroy: () => {
              doc.removeEventListener('mouseup', finishDrag)
              doc.removeEventListener('dragend', finishDrag)
            },
          }
        },
        props: {
          decorations: (state) => sourceKey.getState(state)?.decorations,
          handleKeyDown: (view, event) =>
            handleSourceKey(view, event, sourceKey.getState(view.state)),
          handleDOMEvents: {
            beforeinput: (view, event) =>
              handleSourceBeforeInput(
                view,
                event,
                sourceKey.getState(view.state),
              ),
            mousedown: (view, event) => {
              if (event.button === 0)
                view.dispatch(
                  view.state.tr.setMeta(sourceKey, { dragging: true }),
                )
              return false
            },
            focus: (view) => {
              view.dispatch(view.state.tr.setMeta(sourceKey, { focused: true }))
              return false
            },
            blur: (view) => {
              view.dispatch(
                view.state.tr.setMeta(sourceKey, {
                  focused: false,
                  dragging: false,
                }),
              )
              return false
            },
          },
        },
      }),
    ]
  },
})

function decorate(
  doc: Node,
  spans: SourceSpan[],
  selection: Selection,
  focused: boolean,
): DecorationSet {
  const decorations: Decoration[] = []
  let revealedThrough = -1

  for (const span of spans) {
    const selectionTouchesSpan =
      focused &&
      (selection.empty
        ? selection.from > span.from && selection.from < span.to
        : selection.from < span.to && selection.to > span.from)
    if (selectionTouchesSpan)
      revealedThrough = Math.max(revealedThrough, span.to)

    const revealed = span.to <= revealedThrough

    decorations.push(
      Decoration.inline(span.contentFrom, span.contentTo, {
        class: `md-source-${span.format}`,
      }),
    )

    const attrs = {
      class: 'md-source-delimiter',
      ...(revealed ? {} : { 'data-source-hidden': 'true' }),
    }

    const spec = { hiddenSource: !revealed }

    decorations.push(Decoration.inline(span.from, span.contentFrom, attrs, spec)) // prettier-ignore
    decorations.push(Decoration.inline(span.contentTo, span.to, attrs, spec))
  }

  return DecorationSet.create(doc, decorations)
}

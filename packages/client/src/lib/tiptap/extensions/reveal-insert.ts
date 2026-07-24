import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/** Space kept below the revealed position. */
const MARGIN = 8

const key = new PluginKey<number | null>('revealInsert')

/**
 * Keeps content inserted below the caret on screen to prevent multiline inserts
 * from appearing out of frame.
 */
export const RevealInsert = Extension.create({
  name: 'revealInsert',

  addProseMirrorPlugins() {
    return [
      new Plugin<number | null>({
        key,
        state: {
          init: () => null,
          apply: (tr) => insertedBelowCaret(tr),
        },
        view: () => ({
          update: (view) => {
            const pos = key.getState(view.state)
            if (pos == null) return
            requestAnimationFrame(() => reveal(view, pos))
          },
        }),
      }),
    ]
  },
})

/**
 * The end of the content this transaction inserted after the caret, or null
 * when it inserted nothing there (a plain edit at the caret, or a deletion).
 */
export function insertedBelowCaret(tr: Transaction): number | null {
  if (!tr.docChanged) return null

  let end = -1
  tr.steps.forEach((step, index) => {
    step.getMap().forEach((_from, _to, newFrom, newTo) => {
      if (newTo <= newFrom) return
      end = Math.max(end, tr.mapping.slice(index + 1).map(newTo))
    })
  })

  return end > tr.selection.to ? end : null
}

/** Scrolls `pos` into view without pushing the caret out of it. */
function reveal(view: EditorView, pos: number): void {
  if (view.isDestroyed || pos > view.state.doc.content.size) return

  const container = scrollParent(view.dom)
  if (!container) return

  const bounds = container.getBoundingClientRect()
  const overflow = view.coordsAtPos(pos).bottom + MARGIN - bounds.bottom
  if (overflow <= 0) return

  const caretTop = view.coordsAtPos(view.state.selection.from).top
  const room = caretTop - bounds.top - MARGIN
  const delta = Math.min(overflow, Math.max(room, 0))
  if (delta > 0) container.scrollTop += delta
}

/**
 * The nearest scrollable ancestor, skipping the document itself as there's
 * already a scroller mechanism bound to it.
 */
function scrollParent(from: HTMLElement): HTMLElement | null {
  let node = from.parentElement
  while (node && node !== document.body) {
    const overflow = getComputedStyle(node).overflowY
    if (
      node.scrollHeight > node.clientHeight &&
      (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay')
    ) {
      return node
    }
    node = node.parentElement
  }
  return null
}

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/** An absolute document range the caret can cycle to. */
export type SnippetStop = { from: number; to: number }

type SnippetSession = { stops: SnippetStop[]; index: number } | null

const snippetKey = new PluginKey<SnippetSession>('snippetStops')

/**
 * Starts a multi-placeholder snippet session. The caret is moved to the first
 * stop and the user cycles through the rest with Tab / Shift-Tab. Sessions with
 * fewer than two stops need no navigation and are ignored.
 */
export function activateSnippet(view: EditorView, stops: SnippetStop[]): void {
  if (stops.length < 2) return
  const tr = view.state.tr.setMeta(snippetKey, { stops, index: 0 })
  selectStop(tr, stops[0]!)
  view.dispatch(tr)
}

/** Tracks snippet tab stops and lets Tab / Shift-Tab / Escape navigate them. */
export const SnippetStops = Extension.create({
  name: 'snippetStops',
  // Needs to be higher priority than `CodeEdit`
  priority: 300,

  addKeyboardShortcuts() {
    return {
      Tab: () => moveStop(this.editor.view, 1),
      'Shift-Tab': () => moveStop(this.editor.view, -1),
      Escape: () => clearSession(this.editor.view),
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<SnippetSession>({
        key: snippetKey,
        state: {
          init: () => null,
          apply(tr, session): SnippetSession {
            const meta = tr.getMeta(snippetKey) as SnippetSession | undefined
            if (meta !== undefined) return meta
            if (!session) return null

            const stops = session.stops.map((stop) => ({
              from: tr.mapping.map(stop.from, -1),
              to: tr.mapping.map(stop.to, 1),
            }))
            // End the session once the caret leaves every stop
            if (tr.selectionSet && !withinAnyStop(tr.selection, stops)) {
              return null
            }
            return { stops, index: session.index }
          },
        },
      }),
    ]
  },
})

/** Moves to the next/previous stop. Exits after the last one. */
function moveStop(view: EditorView, dir: 1 | -1): boolean {
  const session = snippetKey.getState(view.state)
  if (!session) return false

  const next = session.index + dir
  if (next < 0) return true // clamp at the first stop

  if (next >= session.stops.length) {
    const last = session.stops[session.stops.length - 1]!
    const tr = view.state.tr.setMeta(snippetKey, null)
    tr.setSelection(TextSelection.create(tr.doc, last.to))
    view.dispatch(tr)
    return true
  }

  const tr = view.state.tr.setMeta(snippetKey, {
    stops: session.stops,
    index: next,
  })
  selectStop(tr, session.stops[next]!)
  view.dispatch(tr)
  return true
}

/** Ends the session so Escape can also close whatever else it normally would. */
function clearSession(view: EditorView): boolean {
  if (!snippetKey.getState(view.state)) return false
  view.dispatch(view.state.tr.setMeta(snippetKey, null))
  return false
}

function selectStop(tr: Transaction, stop: SnippetStop): void {
  tr.setSelection(TextSelection.create(tr.doc, stop.from, stop.to))
}

function withinAnyStop(
  selection: { from: number; to: number },
  stops: SnippetStop[],
): boolean {
  return stops.some(
    (stop) => selection.from >= stop.from && selection.to <= stop.to,
  )
}

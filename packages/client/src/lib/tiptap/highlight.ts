import { getHighlighter } from '@/lib/shiki/core'
import { themeName } from '@/lib/shiki/theme'
import { toPmRange } from '@/lib/tiptap/interpreter-doc'
import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { BundledLanguage, Highlighter } from 'shiki'

/**
 * A highlighting plugin tracks two decoration layers:
 * - `syntax`: monospace + keyword spans, rebuilt synchronously on every doc
 *   change to keep the text consistent.
 * - `colors`: Shiki token colors, rebuilt on a debounce for performance.
 * `combined` is their union, returned to the editor.
 */
export type HighlightState = {
  syntax: DecorationSet
  colors: DecorationSet
  combined: DecorationSet
}

export type HighlightLayers = {
  /** Synchronous layer, so typing never lags behind the monospace font. */
  syntax: (doc: Node) => DecorationSet
  /** Debounced layer, built once the async highlighter has loaded. */
  colors: (doc: Node, highlighter: Highlighter) => DecorationSet
}

const DEBOUNCE_MS = 80

/** Merges the Shiki color layer onto the syntax layer for one document. */
function combine(
  doc: Node,
  syntax: DecorationSet,
  colors: DecorationSet,
): DecorationSet {
  return syntax.add(doc, colors.find())
}

/** A two-layer decoration plugin shared by the syntax highlighting extensions. */
export function highlightPlugin(
  name: string,
  layers: HighlightLayers,
): Plugin<HighlightState> {
  const key = new PluginKey<HighlightState>(name)

  let hl: Highlighter | null = null
  const ready = getHighlighter().then((resolved) => {
    hl = resolved
  })

  return new Plugin<HighlightState>({
    key,
    state: {
      init: (_, editorState) => {
        const syntax = layers.syntax(editorState.doc)
        return { syntax, colors: DecorationSet.empty, combined: syntax }
      },
      apply: (tr, prev) => {
        const meta = tr.getMeta(key) as { colors: DecorationSet } | undefined
        const colors = meta ? meta.colors : prev.colors.map(tr.mapping, tr.doc)
        const syntax = tr.docChanged
          ? layers.syntax(tr.doc)
          : prev.syntax.map(tr.mapping, tr.doc)
        return { syntax, colors, combined: combine(tr.doc, syntax, colors) }
      },
    },
    view: (view) => {
      let timer: ReturnType<typeof setTimeout> | null = null
      let destroyed = false

      const rebuildColors = () => {
        if (destroyed || !hl) return
        const colors = layers.colors(view.state.doc, hl)
        view.dispatch(view.state.tr.setMeta(key, { colors }))
      }

      const schedule = (delay: number) => {
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          rebuildColors()
        }, delay)
      }

      ready.then(() => schedule(0))

      return {
        update: (v, prev) => {
          if (v.state.doc !== prev.doc) schedule(DEBOUNCE_MS)
        },
        destroy: () => {
          destroyed = true
          if (timer !== null) clearTimeout(timer)
        },
      }
    },
    props: {
      decorations: (state) => key.getState(state)?.combined,
    },
  })
}

/** Shiki token colors for a code span starting at the `from` text offset. */
export function tokenColorDecorations(
  code: string,
  from: number,
  positions: number[],
  hl: Highlighter,
  lang: BundledLanguage,
): Decoration[] {
  let lines
  try {
    lines = hl.codeToTokens(code, { lang, theme: themeName }).tokens
  } catch {
    return []
  }

  const decorations: Decoration[] = []
  let offset = from
  for (const line of lines) {
    for (const piece of line) {
      const range = toPmRange(positions, offset, offset + piece.content.length)
      if (range && piece.color) {
        decorations.push(
          Decoration.inline(range[0], range[1], {
            style: `color:${piece.color}`,
          }),
        )
      }
      offset += piece.content.length
    }
    offset += 1
  }
  return decorations
}

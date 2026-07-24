import { getHighlighter } from '@/lib/shiki/core'
import { themeName } from '@/lib/shiki/theme'
import { collectDocText, toPmRange } from '@/lib/tiptap/interpreter-doc'
import {
  type SyntaxToken,
  scanInterpreterSyntax,
} from '@/lib/tiptap/interpreter-syntax'
import { Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Highlighter } from 'shiki'

/**
 * The plugin tracks two decoration layers:
 * - `syntax`: monospace + keyword spans, rebuilt synchronously on every doc
 *   change to keep the text consistent.
 * - `colors`: Shiki JS token colors, rebuilt on a debounce for performance.
 * `combined` is their union, returned to the editor.
 */
type HlState = {
  syntax: DecorationSet
  colors: DecorationSet
  combined: DecorationSet
}

const key = new PluginKey<HlState>('interpreterHighlight')

const DEBOUNCE_MS = 80

/** Merges the Shiki color layer onto the syntax layer for one document. */
function combine(
  doc: Node,
  syntax: DecorationSet,
  colors: DecorationSet,
): DecorationSet {
  return syntax.add(doc, colors.find())
}

/** Syntax highlighting for interpreter directives in the prompt editor. */
export const InterpreterHighlight = Extension.create({
  name: 'interpreterHighlight',

  addProseMirrorPlugins() {
    let hl: Highlighter | null = null
    const ready = getHighlighter().then((resolved) => {
      hl = resolved
    })

    return [
      new Plugin<HlState>({
        key,
        state: {
          init: (_, editorState) => {
            const syntax = buildSyntax(editorState.doc)
            return { syntax, colors: DecorationSet.empty, combined: syntax }
          },
          apply: (tr, prev) => {
            const meta = tr.getMeta(key) as
              { colors: DecorationSet } | undefined
            const colors = meta
              ? meta.colors
              : prev.colors.map(tr.mapping, tr.doc)
            const syntax = tr.docChanged
              ? buildSyntax(tr.doc)
              : prev.syntax.map(tr.mapping, tr.doc)
            return { syntax, colors, combined: combine(tr.doc, syntax, colors) }
          },
        },
        view: (view) => {
          let timer: ReturnType<typeof setTimeout> | null = null
          let destroyed = false

          const rebuildColors = () => {
            if (destroyed || !hl) return
            const colors = buildColors(view.state.doc, hl)
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
      }),
    ]
  },
})

/** Monospace + keyword spans for every directive. */
function buildSyntax(doc: Node): DecorationSet {
  const { text, positions } = collectDocText(doc)
  if (!text.includes('#') && !text.includes('{{')) return DecorationSet.empty

  const decorations: Decoration[] = []
  for (const token of scanInterpreterSyntax(text)) {
    const range = toPmRange(positions, token.from, token.to)
    if (!range) continue
    const cls = token.kind === 'keyword' ? 'interp interp-kw' : 'interp'
    decorations.push(Decoration.inline(range[0], range[1], { class: cls }))
  }
  return DecorationSet.create(doc, decorations)
}

/** Shiki JS token colors overlaid on every code span. */
function buildColors(doc: Node, hl: Highlighter): DecorationSet {
  const { text, positions } = collectDocText(doc)
  if (!text.includes('#') && !text.includes('{{')) return DecorationSet.empty

  const decorations: Decoration[] = []
  for (const token of scanInterpreterSyntax(text)) {
    if (token.kind === 'code') {
      addCodeColors(decorations, token, text, positions, hl)
    }
  }
  return DecorationSet.create(doc, decorations)
}

/** Overlays Shiki JS token colors on a code span. */
function addCodeColors(
  decorations: Decoration[],
  token: SyntaxToken,
  text: string,
  positions: number[],
  hl: Highlighter,
): void {
  const code = text.slice(token.from, token.to)
  let lines
  try {
    lines = hl.codeToTokens(code, {
      lang: 'javascript',
      theme: themeName,
    }).tokens
  } catch {
    return
  }

  let offset = token.from
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
}

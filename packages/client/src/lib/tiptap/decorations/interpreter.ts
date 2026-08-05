import { highlightPlugin, tokenColorDecorations } from '@/lib/tiptap/highlight'
import { collectDocText, toPmRange } from '@/lib/tiptap/interpreter-doc'
import { scanInterpreterSyntax } from '@/lib/tiptap/interpreter-syntax'
import { Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Highlighter } from 'shiki'

/** Syntax highlighting for interpreter directives in the prompt editor. */
export const InterpreterHighlight = Extension.create({
  name: 'interpreterHighlight',

  addProseMirrorPlugins() {
    return [
      highlightPlugin('interpreterHighlight', {
        syntax: buildSyntax,
        colors: buildColors,
      }),
    ]
  },
})

function hasDirectives(text: string): boolean {
  return text.includes('#') || text.includes('{{')
}

/** Monospace + keyword spans for every directive. */
function buildSyntax(doc: Node): DecorationSet {
  const { text, positions } = collectDocText(doc)
  if (!hasDirectives(text)) return DecorationSet.empty

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
  if (!hasDirectives(text)) return DecorationSet.empty

  const decorations: Decoration[] = []
  for (const token of scanInterpreterSyntax(text)) {
    if (token.kind !== 'code') continue
    decorations.push(
      ...tokenColorDecorations(
        text.slice(token.from, token.to),
        token.from,
        positions,
        hl,
        'javascript',
      ),
    )
  }
  return DecorationSet.create(doc, decorations)
}

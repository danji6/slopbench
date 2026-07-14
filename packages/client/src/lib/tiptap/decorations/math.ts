import type { MathMode } from '@/lib/chat'
import { renderMathHtml } from '@/lib/katex/render'
import { Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import type { Selection } from '@tiptap/pm/state'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Editor } from '@tiptap/react'

export interface MathDecorationOptions {
  mathMode: MathMode
}

type MathPluginState = {
  mathMode: MathMode
  spans: Span[]
  revealSig: string
  decorations: DecorationSet
}

const mathKey = new PluginKey<MathPluginState>('mathDecoration')

/** Live-previews `$..$` / `$$..$$` math in the editor with KaTeX. */
export const MathDecoration = Extension.create<MathDecorationOptions>({
  name: 'mathDecoration',

  addOptions() {
    return { mathMode: 'single' }
  },

  addProseMirrorPlugins() {
    const initialMode = this.options.mathMode
    return [
      new Plugin<MathPluginState>({
        key: mathKey,
        state: {
          init: (_, state) => {
            const spans = collectSpans(state.doc, initialMode)
            return {
              mathMode: initialMode,
              spans,
              revealSig: revealSignature(spans, state.selection),
              decorations: buildDecorations(state.doc, spans, state.selection),
            }
          },
          apply: (tr, prev, _old, state) => {
            const meta = tr.getMeta(mathKey) as
              { mathMode: MathMode } | undefined
            const mathMode = meta?.mathMode ?? prev.mathMode
            const modeChanged = mathMode !== prev.mathMode
            if (!modeChanged && !tr.docChanged && !tr.selectionSet) return prev

            // Re-walk the doc only when its content or the math policy changed
            const spans =
              tr.docChanged || modeChanged
                ? collectSpans(state.doc, mathMode)
                : prev.spans
            const revealSig = revealSignature(spans, state.selection)

            if (
              !tr.docChanged &&
              !modeChanged &&
              revealSig === prev.revealSig
            ) {
              return prev
            }

            return {
              mathMode,
              spans,
              revealSig,
              decorations: buildDecorations(state.doc, spans, state.selection),
            }
          },
        },
        props: {
          decorations: (state) => mathKey.getState(state)?.decorations,
        },
      }),
    ]
  },
})

/** Syncs the active math policy into a live editor (see `useMathMode`). */
export function setEditorMathMode(editor: Editor, mathMode: MathMode) {
  editor.view.dispatch(editor.state.tr.setMeta(mathKey, { mathMode }))
}

type Span = { from: number; to: number; latex: string; display: boolean }

/** Walks the doc for every math span, independent of the current selection. */
function collectSpans(doc: Node, mathMode: MathMode): Span[] {
  if (mathMode === 'off') return []

  const spans: Span[] = []
  doc.descendants((node, pos) => {
    if (!node.isBlock || !node.inlineContent) return

    // A block that is entirely a `$$..$$` renders centered display
    const display = matchDisplayBlock(node)
    if (display) {
      spans.push({
        from: pos + 1,
        to: pos + 1 + node.content.size,
        latex: display,
        display: true,
      })
      return false
    }

    node.descendants((child, childPos) => {
      if (!child.isText || !child.text) return
      const base = pos + 1 + childPos
      for (const span of findMath(child.text, mathMode)) {
        spans.push({
          from: base + span.start,
          to: base + span.end,
          latex: span.latex,
          display: span.display,
        })
      }
    })
  })

  return spans
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
    decorations.push(hideSource(span.from, span.to))
    decorations.push(renderWidget(span.from, span.to, span))
  }
  return DecorationSet.create(doc, decorations)
}

function hideSource(from: number, to: number): Decoration {
  return Decoration.inline(from, to, { class: 'math-source' })
}

type MathRender = { latex: string; display: boolean }

function renderWidget(from: number, to: number, math: MathRender): Decoration {
  return Decoration.widget(
    from,
    (view) => {
      const dom = document.createElement('span')
      dom.className = 'math-preview'
      dom.contentEditable = 'false'
      dom.innerHTML = renderMathHtml(math.latex, math.display)
      // Clicking the preview drops the caret into the span to edit its source
      dom.addEventListener('mousedown', (event) => {
        event.preventDefault()
        view.dispatch(
          view.state.tr.setSelection(TextSelection.create(view.state.doc, to)),
        )
        view.focus()
      })
      return dom
    },
    { side: -1, key: `${from}:${math.latex}`, ignoreSelection: true },
  )
}

// A block that is entirely a `$$..$$` or a `\[..\]`
const DISPLAY_BLOCK = /^\$\$((?:(?!\$\$)[\s\S])+)\$\$$/
const DISPLAY_BLOCK_BRACKET = /^\\\[([\s\S]+?)\\\]$/

/** Latex of a block that is entirely a `$$..$$` / `\[..\]`, else null. */
function matchDisplayBlock(node: Node): string | null {
  const text = node.textBetween(0, node.content.size, '\n', '\n').trim()
  const latex = (
    DISPLAY_BLOCK.exec(text)?.[1] ?? DISPLAY_BLOCK_BRACKET.exec(text)?.[1]
  )?.trim()
  return latex ? latex : null
}

type MathSpan = { start: number; end: number; latex: string; display: boolean }

/** Finds inline math spans in a text run, honoring `mode`. */
function findMath(text: string, mode: MathMode): MathSpan[] {
  const spans: MathSpan[] = []
  let i = 0

  while (i < text.length) {
    // LaTeX delimiters `\(..\)` / `\[..\]` mirror `$` / `$$`,
    // matching the renderer's delimiter normalization
    const backslash = matchBackslashMath(text, i, mode)
    if (backslash) {
      spans.push(backslash)
      i = backslash.end
      continue
    }

    if (text[i] !== '$' || text[i - 1] === '\\') {
      i++
      continue
    }

    if (text[i + 1] === '$') {
      const close = indexOfUnescaped(text, '$$', i + 2)
      const latex = close === -1 ? '' : text.slice(i + 2, close)
      if (close !== -1 && latex.trim()) {
        spans.push({ start: i, end: close + 2, latex, display: false })
        i = close + 2
        continue
      }
    } else if (mode === 'single') {
      const close = findInlineClose(text, i + 1)
      const latex = close === -1 ? '' : text.slice(i + 1, close)
      if (close !== -1 && isValidInline(latex)) {
        spans.push({ start: i, end: close + 1, latex, display: false })
        i = close + 1
        continue
      }
    }

    i++
  }

  return spans
}

/** Matches a LaTeX-delimiter span at `i`: `\[..\]` display, `\(..\)` inline. */
function matchBackslashMath(
  text: string,
  i: number,
  mode: MathMode,
): MathSpan | null {
  if (text[i] !== '\\') return null

  if (text[i + 1] === '[') {
    const close = text.indexOf('\\]', i + 2)
    const latex = close === -1 ? '' : text.slice(i + 2, close)
    if (close !== -1 && latex.trim()) {
      return { start: i, end: close + 2, latex, display: false }
    }
  } else if (text[i + 1] === '(' && mode === 'single') {
    const close = text.indexOf('\\)', i + 2)
    const latex = close === -1 ? '' : text.slice(i + 2, close)
    if (close !== -1 && isValidInline(latex)) {
      return { start: i, end: close + 2, latex, display: false }
    }
  }

  return null
}

function indexOfUnescaped(text: string, token: string, from: number): number {
  let at = text.indexOf(token, from)
  while (at > 0 && text[at - 1] === '\\') at = text.indexOf(token, at + 1)
  return at
}

/** Next unescaped single `$` that isn't part of a `$$` delimiter. */
function findInlineClose(text: string, from: number): number {
  for (let j = from; j < text.length; j++) {
    if (text[j] !== '$' || text[j - 1] === '\\') continue
    if (text[j + 1] === '$') {
      j++
      continue
    }
    return j
  }
  return -1
}

/** remark-math's single-dollar guard: no leading/trailing whitespace. */
function isValidInline(latex: string): boolean {
  return latex.length > 0 && !/^\s/.test(latex) && !/\s$/.test(latex)
}

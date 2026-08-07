/// <reference types="bun-types" />
import { InterpreterHighlight } from '@/lib/tiptap/decorations'
import { Markdown } from '@/lib/tiptap/extensions/markdown'
import type { DecorationSet } from '@tiptap/pm/view'
import { Editor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { describe, expect, test } from 'bun:test'

import { setupDom } from '../setup/dom'
import { waitFor } from '../setup/wait'

setupDom()

const extensions = [
  StarterKit.configure({ codeBlock: false }),
  Markdown,
  InterpreterHighlight,
]

/** The extension's live (combined) decoration set. */
function decorationSet(state: Editor['state']): DecorationSet | null {
  for (const plugin of state.plugins) {
    const key = (plugin as { key?: string }).key
    if (typeof key === 'string' && key.startsWith('interpreterHighlight')) {
      const hlState = plugin.getState(state) as { combined: DecorationSet }
      return hlState?.combined ?? null
    }
  }
  return null
}

/** Whether the async Shiki color layer has landed anywhere in the set. */
function hasColors(set: DecorationSet | null): boolean {
  return !!set?.find().some((d) => {
    const style = (d as unknown as { type: { attrs?: { style?: string } } })
      .type.attrs?.style
    return String(style).includes('color:')
  })
}

/** Whether a monospace (`interp`) decoration covers `pos`. */
function isMono(set: DecorationSet | null, pos: number): boolean {
  return !!set?.find(pos, pos + 1).some((d) => {
    const cls = (d as unknown as { type: { attrs?: { class?: string } } }).type
      .attrs?.class
    return String(cls).includes('interp')
  })
}

describe('interpreter highlight', () => {
  // The monospace font is wider than the prose font; the syntax layer is rebuilt
  // synchronously on the insert transaction, so a character typed at a code-span
  // boundary is monospace in the same render — no debounce lag, no width reflow.
  test('mono span covers text inserted at the code-span boundary', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const e = new Editor({
      extensions,
      element: host,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '#eval' },
              { type: 'hardBreak' },
              { type: 'text', text: 'x' },
              { type: 'hardBreak' },
              { type: 'text', text: '#end' },
            ],
          },
        ],
      } as never,
    })
    await waitFor('the async color layer', () =>
      hasColors(decorationSet(e.state)),
    )

    const bodyStart = 7 // para open (0) + "#eval" (1-5) + hardBreak (6) → body at 7
    expect(isMono(decorationSet(e.state), bodyStart)).toBe(true)

    // Insert at the span start; the set is only mapped forward here, not rebuilt.
    e.view.dispatch(e.state.tr.insertText('  ', bodyStart))
    const mapped = decorationSet(e.state)
    expect(isMono(mapped, bodyStart)).toBe(true)
    expect(isMono(mapped, bodyStart + 1)).toBe(true)

    e.destroy()
  }, 20_000)
})

/// <reference types="bun-types" />
import { ShellHighlight } from '@/lib/tiptap/decorations'
import { Markdown } from '@/lib/tiptap/extensions/markdown'
import type { DecorationSet } from '@tiptap/pm/view'
import { Editor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { describe, expect, test } from 'bun:test'

import { setupDom } from '../setup/dom'

setupDom()

const extensions = [
  StarterKit.configure({ codeBlock: false }),
  Markdown,
  ShellHighlight,
]

function editorWith(text: string): Editor {
  const host = document.createElement('div')
  document.body.appendChild(host)
  return new Editor({
    extensions,
    element: host,
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    } as never,
  })
}

/** The extension's live (combined) decoration set. */
function decorationSet(state: Editor['state']): DecorationSet | null {
  for (const plugin of state.plugins) {
    const key = (plugin as { key?: string }).key
    if (typeof key === 'string' && key.startsWith('shellHighlight')) {
      const hlState = plugin.getState(state) as { combined: DecorationSet }
      return hlState?.combined ?? null
    }
  }
  return null
}

/** Every class decoration in the set, as `class` → `[from, to)`. */
function classRanges(set: DecorationSet | null): Record<string, number[]> {
  const ranges: Record<string, number[]> = {}
  for (const d of set?.find() ?? []) {
    const cls = (d as unknown as { type: { attrs?: { class?: string } } }).type
      .attrs?.class
    if (cls) ranges[cls] = [d.from, d.to]
  }
  return ranges
}

/** Whether a Shiki color decoration covers `pos`. */
function hasColor(set: DecorationSet | null, pos: number): boolean {
  return !!set?.find(pos, pos + 1).some((d) => {
    const style = (d as unknown as { type: { attrs?: { style?: string } } })
      .type.attrs?.style
    return String(style).includes('color:')
  })
}

describe('shell highlight', () => {
  test('renders a `$ <command>` message as monospace with a muted prefix', () => {
    const e = editorWith('$ ls -la')

    // "$" sits at position 1 (paragraph open at 0), the command at 3..11
    expect(classRanges(decorationSet(e.state))).toEqual({
      'shell-cmd': [1, 9],
      'shell-cmd-prefix': [1, 3],
    })

    e.destroy()
  })

  test('colors the command with bash tokens', async () => {
    const e = editorWith('$ echo "hi"')
    await new Promise((r) => setTimeout(r, 400)) // let the async highlighter settle

    expect(hasColor(decorationSet(e.state), 3)).toBe(true)

    e.destroy()
  })

  test('leaves ordinary text alone', () => {
    const e = editorWith('costs $ 5 to run')
    expect(classRanges(decorationSet(e.state))).toEqual({})
    e.destroy()
  })

  test('leaves an escaped prefix alone', () => {
    const e = editorWith('\\$ 5 for coffee')
    expect(classRanges(decorationSet(e.state))).toEqual({})
    e.destroy()
  })
})

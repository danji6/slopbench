/// <reference types="bun-types" />
import { HtmlDecoration } from '@/lib/tiptap/decorations/html'
import { Markdown } from '@/lib/tiptap/extensions/markdown'
import { serializeDocumentToMarkdown } from '@/lib/tiptap/serialize'
import type { Decoration } from '@tiptap/pm/view'
import { Editor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { afterEach, describe, expect, test } from 'bun:test'

import { setupDom } from '../setup/dom'

setupDom()

let editor: Editor | undefined

function open(markdown: string): Editor {
  editor = new Editor({
    extensions: [StarterKit, Markdown, HtmlDecoration],
    content: markdown,
    contentType: 'markdown',
  })
  return editor
}

/** Every decoration `HtmlDecoration`'s plugin currently contributes. */
function decorations(source: Editor): Decoration[] {
  const plugin = source.state.plugins.find((p) =>
    String((p as { key?: string }).key).startsWith('htmlDecoration'),
  )
  const set = plugin?.props.decorations?.call(plugin, source.state) as
    { find: () => Decoration[] } | undefined
  return set?.find() ?? []
}

/** Decoration classes, with widgets (which carry none) named 'widget'. */
const classesOf = (source: Editor) =>
  decorations(source)
    .map((deco) => {
      const { type } = deco as unknown as {
        type: { attrs?: { class?: string } }
      }
      return type.attrs?.class ?? 'widget'
    })
    .sort()

afterEach(() => {
  editor?.destroy()
  editor = undefined
})

describe('html preview decorations', () => {
  test('hides the source and adds a preview', () => {
    expect(classesOf(open('a <b>x</b> c'))).toEqual(['html-source', 'widget'])
  })

  test('reveals the source when the caret is inside the span', () => {
    const source = open('a <b>x</b> c')
    const [deco] = decorations(source)
    source.commands.setTextSelection(deco.from + 2)
    expect(decorations(source)).toHaveLength(0)
  })

  test('keeps the preview when the whole span is selected', () => {
    const source = open('a <b>x</b> c')
    source.commands.selectAll()
    expect(classesOf(source)).toEqual(['html-source', 'widget'])
  })

  test('previews a block that is entirely one element', () => {
    // The caret starts in the first paragraph, away from the html block
    const source = open('intro\n\n<div style="color:red">\n<b>x</b>\n</div>')
    const block = source.state.doc.child(1)
    const hidden = decorations(source).find((deco) => deco.from !== deco.to)
    expect(hidden?.from).toBe(
      source.state.doc.content.size - block.nodeSize + 1,
    )
    expect(hidden?.to).toBe(source.state.doc.content.size - 1)
  })

  test('leaves html inside a code block alone', () => {
    expect(decorations(open('```\n<b>x</b>\n```'))).toHaveLength(0)
  })

  test('leaves html inside an inline code mark alone', () => {
    expect(decorations(open('use `<b>x</b>` here'))).toHaveLength(0)
  })

  test('leaves markup the sanitizer would strip alone', () => {
    expect(decorations(open('Use <system-reminder> tags'))).toHaveLength(0)
    expect(decorations(open('<script>alert(1)</script>'))).toHaveLength(0)
  })

  test('leaves markup that renders to nothing alone', () => {
    expect(decorations(open('an empty <span></span> here'))).toHaveLength(0)
  })

  test('does not change what the editor serializes', () => {
    const sources = [
      'a <b>x</b> c',
      '<div style="color:red">🎉 Cool 🎉</div>',
      'line<br>break',
      'Use <system-reminder> tags',
    ]
    for (const source of sources) {
      expect(serializeDocumentToMarkdown(open(source))).toBe(source)
      editor?.destroy()
    }
  })
})

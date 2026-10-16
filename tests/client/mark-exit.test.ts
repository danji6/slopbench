/// <reference types="bun-types" />
import { editorKit } from '@/lib/tiptap/kit'
import { Editor, type JSONContent } from '@tiptap/core'
import { afterEach, expect, test } from 'bun:test'

import { setupDom } from '../setup/dom'

setupDom()
let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
})

function open(content: string | JSONContent): Editor {
  editor = new Editor({
    extensions: editorKit(),
    content,
    ...(typeof content === 'string'
      ? { contentType: 'markdown' as const }
      : {}),
  })
  return editor
}

function press(e: Editor, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key })
  return e.view.someProp('handleKeyDown', (fn) => fn(e.view, event)) === true
}

for (const direction of ['ArrowLeft', 'ArrowRight']) {
  test(`${direction} still exits native underline at its boundary`, () => {
    const e = open({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'word', marks: [{ type: 'underline' }] },
          ],
        },
      ],
    })
    const pos = direction === 'ArrowLeft' ? 1 : 5
    e.commands.setTextSelection(pos)
    const before = e.getJSON()
    expect(press(e, direction)).toBe(true)
    expect(e.getJSON()).toEqual(before)
    expect(e.state.selection.from).toBe(pos)
    e.view.dispatch(e.state.tr.insertText('x'))
    const child =
      direction === 'ArrowLeft'
        ? e.state.doc.firstChild?.firstChild
        : e.state.doc.firstChild?.lastChild
    expect(child?.text).toBe('x')
    expect(child?.marks).toEqual([])
  })

  for (const source of [
    '**word**',
    '*word*',
    '~~word~~',
    '`word`',
    '***word***',
  ]) {
    test(`${direction} enters hidden delimiters one character at a time in ${source}`, () => {
      const e = open(source)
      const before = e.getJSON()
      for (let pos = 1; pos <= source.length + 1; pos++) {
        e.commands.setTextSelection(pos)
        press(e, direction)
        expect(e.getJSON()).toEqual(before)
      }
      e.commands.setTextSelection(
        direction === 'ArrowLeft' ? source.length + 1 : 1,
      )
      expect(press(e, direction)).toBe(true)
      expect(e.state.selection.from).toBe(
        direction === 'ArrowLeft' ? source.length : 2,
      )
    })
  }
}

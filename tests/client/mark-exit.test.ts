/// <reference types="bun-types" />
import { editorKit } from '@/lib/tiptap/kit'
import { Editor, type JSONContent } from '@tiptap/core'
import { afterEach, describe, expect, test } from 'bun:test'

import { setupDom } from '../setup/dom'

setupDom()

let editor: Editor | undefined

afterEach(() => {
  editor?.destroy()
  editor = undefined
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

function press(
  e: Editor,
  key: string,
  modifiers: KeyboardEventInit = {},
): boolean {
  const event = new KeyboardEvent('keydown', { key, ...modifiers })
  return e.view.someProp('handleKeyDown', (fn) => fn(e.view, event)) === true
}

function type(e: Editor, text: string): void {
  for (const char of text) {
    const { from, to } = e.state.selection
    const insert = () => e.state.tr.insertText(char, from, to)
    const handled = e.view.someProp('handleTextInput', (fn) =>
      fn(e.view, from, to, char, insert),
    )
    if (!handled) e.view.dispatch(insert())
  }
}

const formats = [
  { name: 'bold', markdown: '**word**' },
  { name: 'italic', markdown: '*word*' },
  { name: 'strike', markdown: '~~word~~' },
  { name: 'underline', markdown: '<u>word</u>' },
]

describe('inline mark exit in the shared editor kit', () => {
  for (const { name, markdown } of formats) {
    // Underline is a toolbar format; raw HTML intentionally stays literal.
    const content =
      name === 'underline'
        ? {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'word', marks: [{ type: name }] },
                ],
              },
            ],
          }
        : markdown

    for (const direction of ['left', 'right'] as const) {
      test(`${direction} arrow leaves ${name} at its boundary`, () => {
        const e = open(content)
        const position = direction === 'left' ? 1 : 5
        e.commands.setTextSelection(position)
        const before = e.getJSON()

        expect(
          press(e, direction === 'left' ? 'ArrowLeft' : 'ArrowRight'),
        ).toBe(true)
        expect(e.getJSON()).toEqual(before)
        expect(e.state.selection.from).toBe(position)
        type(e, 'x')

        const paragraph = e.state.doc.firstChild!
        const inserted =
          direction === 'left' ? paragraph.firstChild : paragraph.lastChild
        expect(inserted?.text).toBe('x')
        expect(inserted?.marks).toEqual([])
      })
    }
  }

  test('leaves all nested marks at a shared boundary', () => {
    const e = open('***word***')
    e.commands.setTextSelection(5)
    expect(press(e, 'ArrowRight')).toBe(true)
    type(e, 'x')
    expect(e.state.doc.firstChild?.lastChild?.marks).toEqual([])
    expect(
      e.state.doc.firstChild?.firstChild?.marks.map((m) => m.type.name),
    ).toEqual(['bold', 'italic'])
  })

  test('keeps an outer mark that continues beyond the inner mark', () => {
    const e = open('**one *two* three**')
    e.commands.setTextSelection(8)
    expect(press(e, 'ArrowRight')).toBe(true)
    type(e, 'x')
    expect(e.state.doc.nodeAt(8)?.marks.map((m) => m.type.name)).toEqual([
      'bold',
    ])
  })

  test('leaves a mark before plain text without moving over that text', () => {
    const e = open('**word** tail')
    e.commands.setTextSelection(5)
    expect(press(e, 'ArrowRight')).toBe(true)
    type(e, 'x')
    expect(e.state.doc.textContent).toBe('wordx tail')
    expect(e.state.doc.firstChild?.lastChild?.marks).toEqual([])
  })

  test('leaves stored formatting on the left side of an inline range', () => {
    const e = open('head **word**')
    e.commands.setTextSelection(6)
    e.commands.setMark('bold')
    expect(press(e, 'ArrowLeft')).toBe(true)
    type(e, 'x')
    expect(e.state.doc.firstChild?.firstChild?.text).toBe('head x')
    expect(e.state.doc.firstChild?.firstChild?.marks).toEqual([])
  })

  test('does not trap repeated arrows after exiting', () => {
    const e = open('**word**')
    e.commands.setTextSelection(5)
    expect(press(e, 'ArrowRight')).toBe(true)
    expect(press(e, 'ArrowRight')).toBe(false)
    expect(press(e, 'ArrowLeft')).toBe(false)
    // Happy DOM does not move the native caret; simulate moving back inside.
    e.commands.setTextSelection(4)
    type(e, 'x')
    expect(e.state.doc.firstChild?.firstChild?.text).toBe('worxd')
    expect(e.state.doc.firstChild?.firstChild?.marks[0]?.type.name).toBe('bold')
  })

  test('leaves formatting created by markdown input rules', () => {
    const e = open('')
    type(e, '**word**')
    expect(e.state.doc.firstChild?.firstChild?.marks[0]?.type.name).toBe('bold')
    e.commands.setTextSelection(4)
    e.commands.setTextSelection(5)
    expect(press(e, 'ArrowRight')).toBe(true)
    type(e, 'x')
    expect(e.state.doc.firstChild?.lastChild?.marks).toEqual([])
  })

  for (const key of ['ArrowLeft', 'ArrowRight']) {
    test(`${key} inside formatting keeps normal navigation`, () => {
      const e = open('**word**')
      e.commands.setTextSelection(3)
      expect(press(e, key)).toBe(false)
      type(e, 'x')
      expect(e.state.doc.firstChild?.firstChild?.marks[0]?.type.name).toBe(
        'bold',
      )
    })

    test(`${key} does not change a range selection`, () => {
      const e = open('**word**')
      e.commands.setTextSelection({ from: 1, to: 5 })
      const before = e.state
      expect(press(e, key)).toBe(false)
      expect(e.state).toBe(before)
    })

    for (const modifier of ['shiftKey', 'altKey', 'ctrlKey', 'metaKey']) {
      test(`${modifier} + ${key} does not exit formatting`, () => {
        const e = open('**word**')
        e.commands.setTextSelection(key === 'ArrowLeft' ? 1 : 5)
        const before = e.state
        press(e, key, { [modifier]: true })
        expect(e.state).toBe(before)
      })
    }
  }

  test('keeps the existing inline code exit behavior', () => {
    const e = open('`word`')
    e.commands.setTextSelection(5)
    expect(press(e, 'ArrowRight')).toBe(true)
    type(e, 'x')
    expect(e.state.doc.textContent).toBe('word x')
    expect(e.state.doc.firstChild?.lastChild?.marks).toEqual([])
  })
})

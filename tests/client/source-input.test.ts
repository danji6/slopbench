/// <reference types="bun-types" />
import { editorKit } from '@/lib/tiptap/kit'
import { Editor } from '@tiptap/core'
import { afterEach, expect, test } from 'bun:test'

import { setupDom } from '../setup/dom'

setupDom()
let editor: Editor
afterEach(() => editor?.destroy())

function open(source: string): Editor {
  editor = new Editor({
    extensions: editorKit(),
    content: source,
    contentType: 'markdown',
  })
  editor.view.someProp('handleDOMEvents', (handlers) => {
    handlers.focus?.(editor.view, new FocusEvent('focus'))
    return false
  })
  return editor
}

function press(
  e: Editor,
  key: string,
  options: KeyboardEventInit = {},
): boolean {
  const event = new KeyboardEvent('keydown', { key, ...options })
  return e.view.someProp('handleKeyDown', (fn) => fn(e.view, event)) === true
}

for (const source of [
  '**word**',
  '__word__',
  '*word*',
  '~~word~~',
  '`word`',
  '***word***',
  '`` word ``',
]) {
  test(`markers hide outside the source and reveal inside its delimiters in ${source}`, () => {
    const e = open(source)
    for (const pos of [1, source.length + 1]) {
      e.commands.setTextSelection(pos)
      expect(
        e.view.dom.querySelector(
          '.md-source-delimiter:not([data-source-hidden])',
        ),
      ).toBeNull()
    }
    for (let pos = 2; pos <= source.length; pos++) {
      e.commands.setTextSelection(pos)
      expect(e.view.dom.querySelector('[data-source-hidden]')).toBeNull()
    }
  })

  for (const key of ['Backspace', 'Delete']) {
    test(`${key} deletes one delimiter character in ${source}`, () => {
      const e = open(source)
      const backwards = key === 'Backspace'
      e.commands.setTextSelection(backwards ? source.length + 1 : 1)
      expect(press(e, key)).toBe(true)
      expect(e.state.doc.textContent).toBe(
        backwards ? source.slice(0, -1) : source.slice(1),
      )
      e.commands.undo()
      expect(e.state.doc.textContent).toBe(source)
    })
  }
}

test('arrows enter the markers without skipping emoji or combining graphemes', () => {
  const e = open('**👨‍👩‍👧‍👦é**')
  e.commands.setTextSelection(1)
  expect(press(e, 'ArrowRight')).toBe(true)
  expect(e.state.selection.from).toBe(2)
  e.commands.setTextSelection(e.state.doc.textContent.length + 1)
  expect(press(e, 'ArrowLeft')).toBe(true)
  expect(e.state.selection.from).toBe(e.state.doc.textContent.length)
})

test('character deletion preserves complete emoji and combining graphemes', () => {
  const e = open('**👨‍👩‍👧‍👦é**')
  e.commands.setTextSelection(3)
  expect(press(e, 'Delete')).toBe(true)
  expect(e.state.doc.textContent).toBe('**é**')
  e.commands.setTextSelection(5)
  expect(press(e, 'Backspace')).toBe(true)
  expect(e.state.doc.textContent).toBe('****')
})

test('plain text and nonempty selections retain their existing deletion behavior', () => {
  const e = open('plain **word**')
  e.commands.setTextSelection(3)
  expect(press(e, 'Backspace')).toBe(false)
  e.commands.setTextSelection({ from: 9, to: 11 })
  expect(press(e, 'Backspace')).toBe(true)
  expect(e.state.doc.textContent).toBe('plain **rd**')
})

test('source input leaves selection extension, word navigation, and composition to the browser', () => {
  const e = open('**word**')
  e.commands.setTextSelection(9)
  for (const options of [
    { shiftKey: true },
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { isComposing: true },
  ]) {
    const state = e.state
    expect(press(e, 'ArrowLeft', options)).toBe(false)
    expect(e.state).toBe(state)
  }
  expect(press(e, 'Backspace', { isComposing: true })).toBe(false)
  expect(e.state.doc.textContent).toBe('**word**')
})

test('completing a hidden delimiter retains the insertion caret and supports undo', () => {
  const e = open('**test*')
  e.commands.setTextSelection(8)
  const event = new InputEvent('beforeinput', {
    inputType: 'insertText',
    data: '*',
    cancelable: true,
  })
  e.view.dom.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  expect(e.state.doc.textContent).toBe('**test**')
  expect(e.state.selection.from).toBe(9)
  expect(e.view.dom.querySelectorAll('[data-source-hidden]')).toHaveLength(2)
  e.commands.undo()
  expect(e.state.doc.textContent).toBe('**test*')
  e.commands.redo()
  expect(e.state.doc.textContent).toBe('**test**')
  expect(e.state.selection.from).toBe(9)
})

test('insertion beside hidden markers still offers text to other input handlers', () => {
  const e = open('**test**')
  e.commands.setTextSelection(9)
  e.setOptions({
    editorProps: {
      handleTextInput(view, from, to, text) {
        expect({ from, to, text }).toEqual({ from: 9, to: 9, text: 'x' })
        view.dispatch(view.state.tr.insertText('X', from, to))
        return true
      },
    },
  })
  const event = new InputEvent('beforeinput', {
    inputType: 'insertText',
    data: 'x',
    cancelable: true,
  })
  e.view.dom.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  expect(e.state.doc.textContent).toBe('**test**X')
})

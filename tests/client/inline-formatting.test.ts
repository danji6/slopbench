/// <reference types="bun-types" />
import { InterpreterInput } from '@/lib/tiptap/extensions/interpreter-input'
import { type EditorKitOptions, editorKit } from '@/lib/tiptap/kit'
import { pasteCollapsedText } from '@/lib/tiptap/paste'
import {
  serializeBlocksToMarkdown,
  serializeDocumentToMarkdown,
} from '@/lib/tiptap/serialize'
import { Editor } from '@tiptap/core'
import { afterEach, expect, test } from 'bun:test'

import { setupDom } from '../setup/dom'

setupDom()
let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
})

function open(content = '', options: EditorKitOptions = {}): Editor {
  editor = new Editor({
    extensions: [...editorKit(options), InterpreterInput],
    content,
    contentType: 'markdown',
  })
  return editor
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

function enter(e: Editor, modifiers: KeyboardEventInit = {}): void {
  const event = new KeyboardEvent('keydown', { key: 'Enter', ...modifiers })
  e.view.someProp('handleKeyDown', (fn) => fn(e.view, event))
}

for (const prefix of ['', 'abc ']) {
  test(`renders italic immediately after ${JSON.stringify(prefix)}`, () => {
    const e = open()
    type(e, `${prefix}*test*`)
    expect(e.state.doc.textContent).toBe(`${prefix}test`)
    expect(e.state.doc.firstChild?.lastChild?.marks[0]?.type.name).toBe(
      'italic',
    )
  })

  test(`renders italic immediately on a new line after ${JSON.stringify(prefix)}`, () => {
    const e = open('previous')
    e.commands.setTextSelection(9)
    enter(e)
    type(e, `${prefix}*test*`)
    expect(e.state.doc.firstChild?.lastChild?.text).toBe('test')
    expect(e.state.doc.firstChild?.lastChild?.marks[0]?.type.name).toBe(
      'italic',
    )
  })
}

test('an unfinished emphasis does not span a line break while typing', () => {
  const e = open()
  type(e, '*test')
  enter(e)
  type(e, 'test*')
  expect(serializeDocumentToMarkdown(e)).toBe('*test\ntest*')
  expect(e.state.doc.firstChild?.firstChild?.marks.length).toBe(0)
  expect(e.state.doc.firstChild?.lastChild?.marks.length).toBe(0)
})

test('Enter stops active formatting', () => {
  const e = open('*test*')
  e.commands.setTextSelection(5)
  enter(e)
  type(e, 'plain')
  expect(e.state.doc.firstChild?.lastChild?.marks.length).toBe(0)
})

test('an unfinished emphasis does not span a line break after reopening', () => {
  const e = open('*test\ntest*')
  expect(e.state.doc.firstChild?.firstChild?.marks.length).toBe(0)
})

test('reopened blank lines have a caret position between their breaks', () => {
  const e = open('one\n\ntwo')
  expect(e.state.doc.childCount).toBe(1)
  expect(e.getJSON().content?.[0]?.content?.map((node) => node.type)).toEqual([
    'text',
    'hardBreak',
    'hardBreak',
    'text',
  ])
  e.commands.setTextSelection(5)
  type(e, 'middle')
  expect(serializeDocumentToMarkdown(e)).toBe('one\nmiddle\ntwo')
})

for (const [name, delimiter] of [
  ['bold', '**'],
  ['italic', '*'],
  ['italic', '_'],
  ['strike', '~~'],
  ['code', '`'],
]) {
  test(`${delimiter} shortcut works immediately after a hard break`, () => {
    const e = open('previous')
    e.commands.setTextSelection(9)
    enter(e)
    type(e, `${delimiter}test${delimiter}`)
    expect(e.state.doc.firstChild?.lastChild?.text).toBe('test')
    expect(
      e.state.doc.firstChild?.lastChild?.marks.map((mark) => mark.type.name),
    ).toEqual([name])
  })
}

for (const delimiter of ['*', '**', '~~']) {
  test(`${delimiter} cannot match across a parsed newline`, () => {
    const e = open(`${delimiter}first\nsecond`)
    e.commands.setTextSelection(e.state.doc.content.size - 1)
    type(e, delimiter)
    expect(
      e.getJSON().content?.[0]?.content?.every((node) => !node.marks?.length),
    ).toBe(true)
  })
}

for (const modifiers of [{}, { shiftKey: true }, { ctrlKey: true }]) {
  test(`line breaks clear nested marks with ${JSON.stringify(modifiers)}`, () => {
    const e = open('***test***')
    e.commands.setTextSelection(5)
    enter(e, modifiers)
    type(e, 'plain')
    expect(e.state.doc.firstChild?.lastChild?.marks.length).toBe(0)
  })
}

for (const count of [2, 4]) {
  test(`${count} typed newlines survive reopening as editable breaks`, () => {
    const e = open('one')
    e.commands.setTextSelection(4)
    for (let index = 0; index < count; index++) enter(e)
    type(e, 'two')
    const doc = e.getJSON()
    const saved = serializeDocumentToMarkdown(e)
    expect(saved).toBe(`one${'\n'.repeat(count)}two`)
    e.commands.setContent(saved, { contentType: 'markdown' })
    expect(e.getJSON()).toEqual(doc)
  })
}

test('the composer keeps its single-newline paragraph serialization', () => {
  const e = open('one\n\ntwo', { collapseBlocks: true })
  expect(serializeBlocksToMarkdown(e)).toBe('one\ntwo')
})

test('multiline composer paste preserves its blank lines', () => {
  const e = open('', { collapseBlocks: true })
  const clipboardData = new DataTransfer()
  clipboardData.setData('text/plain', 'one\n\ntwo')
  expect(
    pasteCollapsedText(e, new ClipboardEvent('paste', { clipboardData })),
  ).toBe(true)
  expect(serializeBlocksToMarkdown(e)).toBe('one\n\ntwo')
})

test('standalone HTML previews retain their own block', () => {
  const source = 'intro\n\n<div>\n<b>test</b>\n</div>'
  const e = open(source)
  expect(e.state.doc.childCount).toBe(2)
  expect(serializeDocumentToMarkdown(e)).toBe(source)
})

test('input-rule formatting can still be undone with Backspace', () => {
  const e = open('previous')
  e.commands.setTextSelection(9)
  enter(e)
  type(e, '*test*')
  const event = new KeyboardEvent('keydown', { key: 'Backspace' })
  e.view.someProp('handleKeyDown', (fn) => fn(e.view, event))
  expect(e.state.doc.firstChild?.lastChild?.text).toBe('*test*')
  expect(e.state.doc.firstChild?.lastChild?.marks.length).toBe(0)
})

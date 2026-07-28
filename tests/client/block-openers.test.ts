/// <reference types="bun-types" />
import { BlockOpeners } from '@/lib/tiptap/extensions/block-openers'
import { LineBreaks } from '@/lib/tiptap/extensions/line-breaks'
import { Markdown } from '@/lib/tiptap/extensions/markdown'
import { serializeDocumentToMarkdown } from '@/lib/tiptap/serialize'
import { Editor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { afterEach, describe, expect, test } from 'bun:test'

import { setupDom } from '../setup/dom'

setupDom()

let editor: Editor | undefined

afterEach(() => {
  editor?.destroy()
  editor = undefined
})

function open(markdown: string): Editor {
  editor = new Editor({
    extensions: [StarterKit, Markdown, LineBreaks, BlockOpeners],
    content: markdown,
    contentType: 'markdown',
  })
  return editor
}

/** Types text the way the browser does, through the input handlers. */
function type(e: Editor, text: string): void {
  for (const char of text) {
    const { from, to } = e.state.selection
    const insert = () => e.state.tr.insertText(char, from, to)
    const handled = e.view.someProp('handleTextInput', (f) =>
      f(e.view, from, to, char, insert),
    )
    if (!handled) e.view.dispatch(insert())
  }
}

/** Presses a key the way the browser does, through the keydown handlers. */
function press(e: Editor, key: string, shiftKey = false): void {
  const event = new KeyboardEvent('keydown', {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  })
  e.view.someProp('handleKeyDown', (f) => f(e.view, event))
}

/** Drops the caret in front of `needle`. */
function caretBefore(e: Editor, needle: string): void {
  let pos = -1
  e.state.doc.descendants((node, at) => {
    if (pos < 0 && node.isText && node.text?.includes(needle)) {
      pos = at + node.text.indexOf(needle)
    }
  })
  e.commands.setTextSelection(pos)
}

/** Types an opener on the line a break opens, and reports what it made. */
function openOnNewLine(opener: string, body: string): string {
  const e = open('hello')
  e.commands.focus('end')
  press(e, 'Enter')
  type(e, opener)
  type(e, body)
  return serializeDocumentToMarkdown(e)
}

describe('BlockOpeners', () => {
  test('Enter opens a code block on a fence line', () => {
    const e = open('')
    e.commands.focus('end')
    type(e, '```ts')
    press(e, 'Enter')
    type(e, 'code')
    expect(e.state.doc.firstChild?.type.name).toBe('codeBlock')
    expect(serializeDocumentToMarkdown(e)).toBe('```ts\ncode\n```')
  })

  test('Enter opens a code block on a line break', () => {
    const e = open('hello')
    e.commands.focus('end')
    press(e, 'Enter')
    type(e, '```ts')
    press(e, 'Enter')
    type(e, 'code')
    expect(serializeDocumentToMarkdown(e)).toBe('hello\n\n```ts\ncode\n```')
  })

  // Editors that send on Enter break their lines with Shift+Enter
  test('Shift+Enter opens a code block just as Enter does', () => {
    const e = open('hello')
    e.commands.focus('end')
    press(e, 'Enter', true)
    type(e, '```ts')
    press(e, 'Enter', true)
    type(e, 'code')
    expect(serializeDocumentToMarkdown(e)).toBe('hello\n\n```ts\ncode\n```')
  })

  test('a heading opens on a line break', () => {
    expect(openOnNewLine('# ', 'Title')).toBe('hello\n\n# Title')
  })

  test('a list opens on a line break', () => {
    expect(openOnNewLine('- ', 'item')).toBe('hello\n\n- item')
    expect(openOnNewLine('1. ', 'item')).toBe('hello\n\n1. item')
  })

  test('a blockquote opens on a line break', () => {
    expect(openOnNewLine('> ', 'quoted')).toBe('hello\n\n> quoted')
  })

  test('the promoted line becomes the block, not the paragraph', () => {
    const e = open('hello')
    e.commands.focus('end')
    press(e, 'Enter')
    type(e, '# ')
    type(e, 'Title')
    const [first, second] = e.state.doc.content.content
    expect(first.type.name).toBe('paragraph')
    expect(first.textContent).toBe('hello')
    expect(second.type.name).toBe('heading')
    expect(second.textContent).toBe('Title')
  })

  test('a line between two others is promoted on its own', () => {
    const e = open('one\ntwo\nthree')
    caretBefore(e, 'two')
    type(e, '# ')
    expect(serializeDocumentToMarkdown(e)).toBe('one\n\n# two\n\nthree')
  })

  test('a blank line above is not doubled', () => {
    const e = open('hello')
    e.commands.focus('end')
    press(e, 'Enter')
    press(e, 'Enter')
    type(e, '# ')
    type(e, 'Title')
    expect(serializeDocumentToMarkdown(e)).toBe('hello\n\n# Title')
  })

  test('a marker within a line is left alone', () => {
    const e = open('hello')
    e.commands.focus('end')
    press(e, 'Enter')
    type(e, 'see # ')
    expect(e.state.doc.childCount).toBe(1)
    expect(serializeDocumentToMarkdown(e)).toBe('hello\nsee #')
  })

  // A line break is meant to behave exactly like a paragraph start, where
  // Enter closes a bare marker the same way
  test('Enter closes a bare marker, as it does in a paragraph', () => {
    const e = open('hello')
    e.commands.focus('end')
    press(e, 'Enter')
    type(e, '#')
    press(e, 'Enter')
    type(e, 'x')
    expect(serializeDocumentToMarkdown(e)).toBe('hello\n\n# x')
  })
})

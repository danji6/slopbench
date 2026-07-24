/// <reference types="bun-types" />
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
    extensions: [StarterKit, Markdown, LineBreaks],
    content: markdown,
    contentType: 'markdown',
  })
  return editor
}

/** Drops the caret at the start of the line holding `needle`. */
function caretAtLineStart(e: Editor, needle: string): void {
  let pos = -1
  e.state.doc.descendants((node, at) => {
    if (pos < 0 && node.isText && node.text?.startsWith(needle)) pos = at
  })
  e.commands.setTextSelection(pos)
}

describe('LineBreaks', () => {
  test('Enter inserts a line break, not a paragraph break', () => {
    const e = open('a')
    e.commands.focus('end')
    e.commands.keyboardShortcut('Enter')
    e.commands.insertContent('b')
    expect(serializeDocumentToMarkdown(e)).toBe('a\nb')
  })

  test('Enter twice still makes a blank line', () => {
    const e = open('a')
    e.commands.focus('end')
    e.commands.keyboardShortcut('Enter')
    e.commands.keyboardShortcut('Enter')
    e.commands.insertContent('b')
    expect(serializeDocumentToMarkdown(e)).toBe('a\n\nb')
  })

  test('Enter in a list still makes a list item', () => {
    const e = open('- one')
    e.commands.focus('end')
    e.commands.keyboardShortcut('Enter')
    e.commands.insertContent('two')
    expect(serializeDocumentToMarkdown(e)).toBe('- one\n- two')
  })

  test('Backspace at a paragraph start leaves a line break', () => {
    const e = open('a\n\nb')
    caretAtLineStart(e, 'b')
    e.commands.keyboardShortcut('Backspace')
    expect(serializeDocumentToMarkdown(e)).toBe('a\nb')
  })

  // Deleting the break itself is the browser's own Backspace, which happy-dom
  // does not emulate; all that matters here is that we leave it alone.
  test('Backspace inside a line is left to the browser', () => {
    const e = open('a\n\nb')
    caretAtLineStart(e, 'b')
    e.commands.keyboardShortcut('Backspace')
    const afterFirst = serializeDocumentToMarkdown(e)
    e.commands.keyboardShortcut('Backspace')
    expect(serializeDocumentToMarkdown(e)).toBe(afterFirst)
  })

  test('Backspace after a heading is left to the default', () => {
    const e = open('# Head\n\nbody')
    caretAtLineStart(e, 'body')
    e.commands.keyboardShortcut('Backspace')
    expect(serializeDocumentToMarkdown(e)).not.toContain('# Head\nbody')
  })
})

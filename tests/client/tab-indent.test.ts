/// <reference types="bun-types" />
import { INDENT_UNIT } from '@/lib/tiptap/code-pairs'
import { CodeEdit } from '@/lib/tiptap/extensions/code-edit'
import { InterpreterInput } from '@/lib/tiptap/extensions/interpreter-input'
import { Markdown } from '@/lib/tiptap/extensions/markdown'
import { SnippetStops } from '@/lib/tiptap/extensions/snippet-stops'
import { TabIndent } from '@/lib/tiptap/extensions/tab-indent'
import { GapCursor } from '@tiptap/pm/gapcursor'
import { TextSelection } from '@tiptap/pm/state'
import { Editor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { describe, expect, test } from 'bun:test'

import { setupDom } from '../setup/dom'

setupDom()

const extensions = [
  StarterKit,
  Markdown,
  CodeEdit,
  InterpreterInput,
  SnippetStops,
  TabIndent,
]

/** A doc whose lines are each their own paragraph. */
function paragraphs(...lines: string[]) {
  return {
    type: 'doc',
    content: lines.map((text) => ({
      type: 'paragraph',
      content: text ? [{ type: 'text', text }] : [],
    })),
  }
}

/** A doc holding one bullet list with the given item texts. */
function bullets(...items: string[]) {
  return {
    type: 'doc',
    content: [
      {
        type: 'bulletList',
        content: items.map((text) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        })),
      },
    ],
  }
}

/** The document text with blocks and hard breaks as newlines. */
function text(e: Editor): string {
  const { doc } = e.state
  return doc.textBetween(0, doc.content.size, '\n', '\n')
}

/** Drops the caret right before the first occurrence of `needle`. */
function caretBefore(editor: Editor, needle: string): void {
  let at = -1
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text?.includes(needle)) {
      at = pos + node.text.indexOf(needle)
    }
  })
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)),
  )
}

/** Selects from before `a` to before `b`, spanning whatever lies between. */
function selectBetween(editor: Editor, a: string, b: string): void {
  let from = -1
  let to = -1
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      if (from < 0 && node.text.includes(a)) from = pos + node.text.indexOf(a)
      if (from >= 0 && to < 0 && node.text.includes(b)) {
        to = pos + node.text.indexOf(b)
      }
    }
  })
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, from, to),
    ),
  )
}

/** Presses a key the way the browser would; reports whether it was handled. */
function press(editor: Editor, key: string, shiftKey = false): boolean {
  const event = new KeyboardEvent('keydown', {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  })
  return (
    editor.view.someProp('handleKeyDown', (fn) => fn(editor.view, event)) ===
    true
  )
}

describe('TabIndent fallback', () => {
  test('Tab indents plain prose instead of moving focus', () => {
    const e = new Editor({
      extensions,
      content: paragraphs('hello world') as never,
    })
    caretBefore(e, 'world')

    expect(press(e, 'Tab')).toBe(true)
    expect(text(e)).toBe(`hello ${INDENT_UNIT}world`)
    e.destroy()
  })

  test('Shift-Tab dedents the caret line one unit per press', () => {
    const e = new Editor({
      extensions,
      content: paragraphs('    deep') as never,
    })
    caretBefore(e, 'deep')

    expect(press(e, 'Tab', true)).toBe(true)
    expect(text(e)).toBe(`${INDENT_UNIT}deep`)
    expect(press(e, 'Tab', true)).toBe(true)
    expect(text(e)).toBe('deep')
    e.destroy()
  })

  test('Shift-Tab on unindented prose is swallowed without changes', () => {
    const e = new Editor({
      extensions,
      content: paragraphs('flush') as never,
    })
    caretBefore(e, 'flush')

    expect(press(e, 'Tab', true)).toBe(true)
    expect(text(e)).toBe('flush')
    e.destroy()
  })

  test('Tab at a gap cursor is swallowed without inserting a block', () => {
    const e = new Editor({
      extensions,
      content: {
        type: 'doc',
        content: [
          { type: 'horizontalRule' },
          { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
        ],
      } as never,
    })
    e.view.dispatch(
      e.state.tr.setSelection(new GapCursor(e.state.doc.resolve(1))),
    )
    const before = e.getJSON()

    expect(press(e, 'Tab')).toBe(true)
    expect(e.getJSON()).toEqual(before)
    e.destroy()
  })

  test('A spanning selection indents every touched line', () => {
    const e = new Editor({
      extensions,
      content: paragraphs('one', 'two', 'three') as never,
    })
    selectBetween(e, 'n', 'h')

    expect(press(e, 'Tab')).toBe(true)
    expect(text(e)).toBe(
      `${INDENT_UNIT}one\n${INDENT_UNIT}two\n${INDENT_UNIT}three`,
    )

    expect(press(e, 'Tab', true)).toBe(true)
    expect(text(e)).toBe('one\ntwo\nthree')
    e.destroy()
  })

  test('Only the caret line dedents when lines share a paragraph', () => {
    const e = new Editor({
      extensions,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: `${INDENT_UNIT}a` },
              { type: 'hardBreak' },
              { type: 'text', text: `${INDENT_UNIT}b` },
            ],
          },
        ],
      } as never,
    })
    caretBefore(e, 'b')

    expect(press(e, 'Tab', true)).toBe(true)
    expect(text(e)).toBe(`${INDENT_UNIT}a\nb`)
    e.destroy()
  })

  test('List items still sink before the fallback applies', () => {
    const e = new Editor({
      extensions,
      content: bullets('first', 'second') as never,
    })
    caretBefore(e, 'second')

    expect(press(e, 'Tab')).toBe(true)

    let nested = false
    e.state.doc.descendants((node, _pos, parent) => {
      if (node.type.name === 'bulletList' && parent?.type.name === 'listItem') {
        nested = true
      }
    })
    expect(nested).toBe(true)
    expect(text(e)).toContain('first')
    expect(text(e)).toContain('second')
    e.destroy()
  })

  test('Code blocks keep their own Tab handling', () => {
    const e = new Editor({
      extensions,
      content: {
        type: 'doc',
        content: [
          {
            type: 'codeBlock',
            attrs: { language: 'js' },
            content: [{ type: 'text', text: 'x' }],
          },
        ],
      } as never,
    })
    caretBefore(e, 'x')

    expect(press(e, 'Tab')).toBe(true)
    // StarterKit's trailing node adds an empty paragraph after the block
    expect(text(e)).toStartWith(`${INDENT_UNIT}x`)
    e.destroy()
  })

  test('A selection spanning code and prose indents both blocks', () => {
    const e = new Editor({
      extensions,
      content: {
        type: 'doc',
        content: [
          {
            type: 'codeBlock',
            attrs: { language: 'js' },
            content: [{ type: 'text', text: 'code' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'prose' }],
          },
        ],
      } as never,
    })
    selectBetween(e, 'code', 'ose')

    expect(press(e, 'Tab')).toBe(true)
    expect(text(e)).toBe(`${INDENT_UNIT}code\n${INDENT_UNIT}prose`)
    e.destroy()
  })

  test('A selection spanning interpreter lines indents every block', () => {
    const e = new Editor({
      extensions,
      content: paragraphs('#eval', 'return x', 'return y', '#end') as never,
    })
    selectBetween(e, 'return x', 'y')

    expect(press(e, 'Tab')).toBe(true)
    expect(text(e)).toBe(
      `#eval\n${INDENT_UNIT}return x\n${INDENT_UNIT}return y\n#end`,
    )
    e.destroy()
  })
})

import { InterpreterInput } from '@/lib/tiptap/extensions/interpreter-input'
import { editorKit } from '@/lib/tiptap/kit'
import { serializeDocumentToMarkdown } from '@/lib/tiptap/serialize'
import { Editor, type JSONContent } from '@tiptap/core'
import { afterEach, describe, expect, test } from 'bun:test'

import { setupDom } from '../setup/dom'

setupDom()
let editor: Editor
afterEach(() => editor?.destroy())

function open(content: JSONContent): Editor {
  editor = new Editor({
    extensions: [...editorKit({ tables: true }), InterpreterInput],
    content: { type: 'doc', content: [content] },
  })
  return editor
}

function textBlock(text: string, type = 'paragraph'): JSONContent {
  return { type, content: text ? [{ type: 'text', text }] : [] }
}

function caret(e: Editor, needle: string, offset = needle.length): void {
  let position = -1
  e.state.doc.descendants((node, pos) => {
    if (position < 0 && node.isText && node.text?.includes(needle)) {
      position = pos + node.text.indexOf(needle) + offset
    }
  })
  expect(position).toBeGreaterThan(0)
  e.commands.setTextSelection(position)
}

function input(e: Editor, text: string): boolean {
  const { from, to } = e.state.selection
  const insert = () => e.state.tr.insertText(text, from, to)
  const handled =
    e.view.someProp('handleTextInput', (handler) =>
      handler(e.view, from, to, text, insert),
    ) === true
  if (!handled) e.view.dispatch(insert())
  return handled
}

function press(e: Editor, options: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    cancelable: true,
    ...options,
  })
  return (
    e.view.someProp('handleKeyDown', (handler) => handler(e.view, event)) ===
    true
  )
}

function source(e: Editor): string {
  return e.state.doc.textBetween(0, e.state.doc.content.size, '\n', '\n')
}

describe('XML tag input in the production editor kit', () => {
  test.each(['div', 'custom-tag', 'system-reminder', 'ns:Custom'])(
    'closes %s and leaves the caret inside',
    (name) => {
      const e = open(textBlock(`before <${name}`))
      caret(e, `<${name}`)
      expect(input(e, '>')).toBe(true)
      expect(source(e)).toBe(`before <${name}></${name}>`)
      expect(e.state.selection.$from.nodeAfter?.text).toBe(`</${name}>`)
      expect(serializeDocumentToMarkdown(e)).toBe(`before <${name}></${name}>`)
      e.commands.undo()
      expect(source(e)).toBe(`before <${name}`)
      e.commands.redo()
      expect(source(e)).toBe(`before <${name}></${name}>`)
      expect(e.state.selection.$from.nodeAfter?.text).toBe(`</${name}>`)
    },
  )

  test('does not expand a greater-than sign inside an attribute', () => {
    const e = open(textBlock('<div title="a < b'))
    caret(e, 'b')
    expect(input(e, '>')).toBe(false)
    input(e, ' c"')
    expect(input(e, '>')).toBe(true)
    expect(source(e)).toBe('<div title="a < b> c"></div>')
  })

  test('uses an existing closer while reserving the outer one for nested names', () => {
    const e = open(textBlock('<div</div>'))
    caret(e, '<div')
    expect(input(e, '>')).toBe(false)
    expect(source(e)).toBe('<div></div>')
    input(e, '<div')
    expect(input(e, '>')).toBe(true)
    expect(source(e)).toBe('<div><div></div></div>')
  })

  test.each(['</div', '<br', '<div/', '<!-- <tag', '<div bad='])(
    'leaves excluded input literal: %s',
    (prefix) => {
      const e = open(textBlock(prefix))
      caret(e, prefix)
      expect(input(e, '>')).toBe(false)
      expect(source(e)).toBe(`${prefix}>`)
    },
  )

  const contexts: JSONContent[] = [
    textBlock('<tag'),
    textBlock('`<tag`'),
    textBlock('<tag', 'codeBlock'),
    {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [textBlock('<tag')] }],
    },
    { type: 'blockquote', content: [textBlock('<tag')] },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [{ type: 'tableCell', content: [textBlock('<tag')] }],
        },
      ],
    },
  ]

  test.each(contexts)('expands in a $type context', (content) => {
    const e = open(content)
    caret(e, '<tag')
    expect(input(e, '>')).toBe(true)
    expect(source(e)).toContain('<tag></tag>')
    expect(press(e)).toBe(true)
    expect(source(e)).toContain('<tag>\n  \n</tag>')
    expect(
      e.state.selection.$from.parent.textBetween(
        0,
        e.state.selection.$from.parentOffset,
        '\n',
        '\n',
      ),
    ).toEndWith('\n  ')
  })

  test.each([false, true])(
    'smart newline preserves indentation (Shift=%s)',
    (shiftKey) => {
      const e = open(textBlock('  before <tag></tag> after'))
      caret(e, '<tag>')
      expect(press(e, { shiftKey })).toBe(true)
      expect(source(e)).toBe('  before <tag>\n    \n  </tag> after')
      const restoredCaret = e.state.selection.from
      e.commands.undo()
      expect(source(e)).toBe('  before <tag></tag> after')
      e.commands.redo()
      expect(source(e)).toBe('  before <tag>\n    \n  </tag> after')
      expect(e.state.selection.from).toBe(restoredCaret)
      expect(serializeDocumentToMarkdown(e)).toContain('<tag>\n\n  </tag>')
    },
  )

  test('preserves active formatting', () => {
    const e = open({
      type: 'paragraph',
      content: [{ type: 'text', text: '<tag', marks: [{ type: 'bold' }] }],
    })
    caret(e, '<tag')
    expect(input(e, '>')).toBe(true)
    expect(source(e)).toBe('**<tag></tag>**')
    expect(serializeDocumentToMarkdown(e)).toBe('**<tag></tag>**')
  })

  test('does not transform loaded, pasted, or programmatically inserted content', () => {
    const e = open(textBlock('<loaded>'))
    e.commands.setTextSelection(e.state.doc.content.size - 1)
    e.commands.insertContent({ type: 'text', text: '<inserted>' })
    input(e, '<pasted>')
    expect(source(e)).not.toContain('</')
  })

  test('does not expand nonempty selections or read-only input', () => {
    const e = open(textBlock('<tagX'))
    e.commands.setTextSelection({ from: 5, to: 6 })
    expect(input(e, '>')).toBe(false)
    expect(source(e)).toBe('<tag>')
    e.commands.setContent({ type: 'doc', content: [textBlock('<other')] })
    caret(e, '<other')
    e.setEditable(false)
    expect(input(e, '>')).toBe(false)
    expect(source(e)).toBe('<other>')
  })

  test('does not auto-close tags during composition', () => {
    const e = open(textBlock('<tag'))
    caret(e, '<tag')
    Object.defineProperty(e.view, 'composing', { value: true })
    expect(input(e, '>')).toBe(false)
    expect(source(e)).toBe('<tag>')
  })

  test('keeps body typing and each expansion in separate undo steps', () => {
    const e = open(textBlock('<tag'))
    caret(e, '<tag')
    input(e, '>')
    press(e)
    input(e, 'body')
    e.commands.undo()
    expect(source(e)).toBe('<tag>\n  \n</tag>')
    e.commands.undo()
    expect(source(e)).toBe('<tag></tag>')
    e.commands.undo()
    expect(source(e)).toBe('<tag')
    for (let step = 0; step < 3; step++) e.commands.redo()
    expect(source(e)).toBe('<tag>\n  body\n</tag>')
  })

  test('leaves composition and modified Enter to existing handlers', () => {
    const e = open(textBlock('<tag></tag>'))
    caret(e, '<tag>')
    for (const options of [
      { isComposing: true },
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
    ]) {
      const before = source(e)
      press(e, options)
      expect(source(e)).not.toBe('<tag>\n  \n</tag>')
      e.commands.setContent({ type: 'doc', content: [textBlock(before)] })
      caret(e, '<tag>')
    }
  })

  test.each([false, true])(
    'host send chord keeps priority (invertSend=%s)',
    (invertSend) => {
      const e = open(textBlock('<tag></tag>'))
      caret(e, '<tag>')
      let sends = 0
      e.setOptions({
        editorProps: {
          handleKeyDown: (_view, event) => {
            if (event.key !== 'Enter') return false
            const send = invertSend ? event.shiftKey : !event.shiftKey
            if (send) sends++
            return send
          },
        },
      })
      press(e, { shiftKey: invertSend })
      expect(sends).toBe(1)
      expect(source(e)).toBe('<tag></tag>')
      press(e, { shiftKey: !invertSend })
      expect(sends).toBe(1)
      expect(source(e)).toBe('<tag>\n  \n</tag>')
    },
  )
})

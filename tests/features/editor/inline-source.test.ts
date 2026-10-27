/// <reference types="bun-types" />
import { opensBlock } from '@/lib/tiptap/extensions/block-openers'
import {
  collectSourceSpans,
  scanInlineSource,
} from '@/lib/tiptap/inline-source'
import { editorKit } from '@/lib/tiptap/kit'
import {
  serializeDocumentToMarkdown,
  serializeSliceToMarkdown,
} from '@/lib/tiptap/serialize'
import { Editor, type JSONContent } from '@tiptap/core'
import { DOMParser } from '@tiptap/pm/model'
import { afterEach, expect, test } from 'bun:test'
import { setupDom } from '~/tests/setup/dom'

setupDom()
const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
})

function open(content: string | JSONContent = ''): Editor {
  const editor = new Editor({
    extensions: editorKit({ math: 'single', tables: true }),
    content,
    ...(typeof content === 'string'
      ? { contentType: 'markdown' as const }
      : {}),
  })
  editors.push(editor)
  return editor
}

function focus(e: Editor, focused = true): void {
  const event = new FocusEvent(focused ? 'focus' : 'blur')
  e.view.someProp('handleDOMEvents', (handlers) => {
    handlers[focused ? 'focus' : 'blur']?.(e.view, event)
    return false
  })
}

for (const source of [
  '**bold** and _italic_ and ~~strike~~ and `code`',
  '__bold__ *italic* ~strike~',
  '**outer *inner* text**',
  '***nested***',
  'before \\*literal\\* and **bold**',
  'a `` code ` with ticks `` b',
  '` **literal** $x$ <b>hi</b> `',
  '**[link](https://example.com)**',
  '[**label**](attachment:token/file)',
  '*unfinished',
  '**first\nsecond**',
]) {
  test(`preserves editable source on repeated saves: ${source}`, () => {
    const e = open(source)
    expect(serializeDocumentToMarkdown(e)).toBe(source)
    const next = open(serializeDocumentToMarkdown(e))
    expect(next.getJSON()).toEqual(e.getJSON())
    expect(next.state.doc.textContent).toContain(
      source.includes('[link]') ? '**link**' : '',
    )
  })
}

test('reveals only the enclosing nested group and preserves content during navigation', () => {
  const e = open('**outer *inner* text** and ~~other~~')
  const before = e.getJSON()
  let updates = 0
  e.on('update', () => {
    updates++
  })
  expect(e.view.dom.querySelectorAll('[data-source-hidden]')).toHaveLength(6)
  focus(e)
  e.commands.setTextSelection(11)
  expect(e.view.dom.querySelectorAll('[data-source-hidden]')).toHaveLength(2)
  expect(
    e.view.dom.querySelectorAll(
      '.md-source-delimiter:not([data-source-hidden])',
    ),
  ).toHaveLength(4)
  e.commands.setTextSelection(25)
  expect(e.view.dom.querySelectorAll('[data-source-hidden]')).toHaveLength(6)
  e.commands.setTextSelection(11)
  focus(e, false)
  expect(e.view.dom.querySelectorAll('[data-source-hidden]')).toHaveLength(6)
  expect(e.getJSON()).toEqual(before)
  expect(updates).toBe(0)
  expect(e.commands.undo()).toBe(false)
})

test('a selection reveals every touched group, including delimiters', () => {
  const e = open('**one** and *two*')
  focus(e)
  e.commands.selectAll()
  expect(e.view.dom.querySelector('[data-source-hidden]')).toBeNull()
})

test('removing a closing delimiter leaves incomplete source and undo restores it', () => {
  const e = open('**word**')
  e.commands.setTextSelection(8)
  e.commands.deleteRange({ from: 7, to: 9 })
  expect(serializeDocumentToMarkdown(e)).toBe('**word')
  expect(e.view.dom.querySelector('.md-source-bold')).toBeNull()
  e.commands.undo()
  expect(serializeDocumentToMarkdown(e)).toBe('**word**')
  expect(e.view.dom.querySelector('.md-source-bold')?.textContent).toBe('word')
})

for (const [name, command, delimiter] of [
  ['bold', 'toggleBold', '**'],
  ['italic', 'toggleItalic', '*'],
  ['strike', 'toggleStrike', '~~'],
  ['code', 'toggleCode', '`'],
] as const) {
  test(`${command} wraps and unwraps source with selection preserved`, () => {
    const e = open('word')
    e.commands.selectAll()
    expect(e.commands[command]()).toBe(true)
    expect(serializeDocumentToMarkdown(e)).toBe(`${delimiter}word${delimiter}`)
    expect(e.state.selection.from).toBe(1 + delimiter.length)
    expect(e.view.dom.querySelector(`.md-source-${name}`)?.textContent).toBe(
      'word',
    )
    e.commands[command]()
    expect(serializeDocumentToMarkdown(e)).toBe('word')
    expect(e.state.selection.from).toBe(1)
    expect(e.state.selection.to).toBe(5)
  })
}

test('empty-selection shortcut inserts a pair with the caret inside', () => {
  const e = open('')
  e.commands.toggleBold()
  expect(e.state.doc.textContent).toBe('****')
  expect(e.state.selection.from).toBe(3)
  e.view.dispatch(e.state.tr.insertText('word'))
  expect(serializeDocumentToMarkdown(e)).toBe('**word**')
})

test('clear formatting removes nested pairs and keeps text and selection', () => {
  const e = open('**outer *inner* text**')
  e.commands.selectAll()
  e.commands.unsetAllMarks()
  expect(serializeDocumentToMarkdown(e)).toBe('outer inner text')
  expect(e.state.selection.from).toBe(1)
  expect(e.state.selection.to).toBe(17)
})

test('inline code command chooses a safe fence for embedded backticks', () => {
  const e = open('a ` b')
  e.commands.selectAll()
  e.commands.toggleCode()
  expect(serializeDocumentToMarkdown(e)).toBe('``a ` b``')
  expect(e.view.dom.querySelector('.md-source-code')?.textContent).toBe('a ` b')
})

test('copies exactly the selected source, with no synthesized wrappers', () => {
  const e = open('**word**')
  e.commands.setTextSelection({ from: 3, to: 5 })
  expect(serializeSliceToMarkdown(e, e.state.selection.content())).toBe('wo')
  e.commands.setTextSelection({ from: 1, to: 5 })
  expect(serializeSliceToMarkdown(e, e.state.selection.content())).toBe('**wo')
})

test('normalizes old JSON drafts and incoming native HTML without duplicate delimiters', () => {
  const e = open({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'one ', marks: [{ type: 'bold' }] },
          {
            type: 'text',
            text: 'two',
            marks: [{ type: 'bold' }, { type: 'italic' }],
          },
        ],
      },
    ],
  })
  expect(e.state.doc.textContent).toBe('**one *two***')
  expect(serializeDocumentToMarkdown(e)).toBe('**one *two***')
  e.commands.selectAll()
  e.commands.insertContent('<strong>new</strong>')
  expect(e.state.doc.textContent).toBe('**new**')
  expect(serializeDocumentToMarkdown(e)).toBe('**new**')
  e.commands.undo()
  expect(serializeDocumentToMarkdown(e)).toBe('**one *two***')
})

test('rereading decorated DOM cannot turn previews into native marks', () => {
  const e = open('**bold** and `code`')
  const parsed = DOMParser.fromSchema(e.schema).parse(e.view.dom)
  e.commands.setContent(parsed.toJSON())
  expect(serializeDocumentToMarkdown(e)).toBe('**bold** and `code`')
})

test('math and HTML previews leave inline code opaque', () => {
  const e = open('`$x$ <b>hi</b> **literal**` and $y$ and <b>yes</b>')
  expect(e.view.dom.querySelectorAll('.math-preview')).toHaveLength(1)
  expect(e.view.dom.querySelectorAll('.html-preview')).toHaveLength(1)
  expect(e.view.dom.querySelector('.md-source-bold')).toBeNull()
})

test('block rules cannot open headings inside a multiline code span', () => {
  const e = open('`line\n# end`')
  const text = e.state.doc.textContent
  e.commands.setTextSelection(text.indexOf('#') + 2)
  expect(opensBlock(e.state, ' ')).toBe(false)
})

test('does not format interpreter code or literal HTML', () => {
  const e = open('#eval\na ** b\n#end\n<div>**literal**</div>')
  expect(e.view.dom.querySelector('.md-source-bold')).toBeNull()
})

test('keeps emphasis confined to a line and handles nested offsets', () => {
  const e = open('**first\nsecond**')
  expect(collectSourceSpans(e.state.doc, e.markdown!)).toEqual([])
  expect(
    scanInlineSource(e.markdown!, '***word***').map((span) => span.format),
  ).toEqual(['italic', 'bold'])
})

test('native HTML formatting keeps link targets balanced through normalization', () => {
  const e = open('')
  e.commands.insertContent(
    '<a href="https://example.com"><strong>word</strong></a>',
  )
  const saved = serializeDocumentToMarkdown(e)
  expect(saved).toBe('**[word](https://example.com)**')
  const next = open(saved)
  expect(serializeDocumentToMarkdown(next)).toBe(saved)
  expect(next.view.dom.querySelector('.md-source-bold')?.textContent).toBe(
    'word',
  )
})

test('commands format every selected line rather than creating multiline emphasis', () => {
  const e = open('one\ntwo\n\nthree')
  e.commands.selectAll()
  e.commands.toggleBold()
  expect(serializeDocumentToMarkdown(e)).toBe('**one**\n**two**\n\n**three**')
  expect(e.view.dom.querySelectorAll('.md-source-bold')).toHaveLength(3)
})

test('commands merge already formatted and plain text within the selection', () => {
  const e = open('**one** and two')
  e.commands.selectAll()
  e.commands.toggleBold()
  expect(serializeDocumentToMarkdown(e)).toBe('**one and two**')
})

test('table cells keep independently editable source and structure', () => {
  const e = open('| One | Two |\n| --- | --- |\n| **bold** | `code` |')
  expect(e.view.dom.querySelectorAll('table')).toHaveLength(1)
  expect(e.view.dom.querySelector('.md-source-bold')?.textContent).toBe('bold')
  expect(e.view.dom.querySelector('.md-source-code')?.textContent).toBe('code')
  const saved = serializeDocumentToMarkdown(e)
  expect(serializeDocumentToMarkdown(open(saved))).toBe(saved)
})

test('format commands absorb partially selected matching spans without broken delimiters', () => {
  const e = open('plain **one two**')
  e.commands.setTextSelection({ from: 1, to: 12 })
  e.commands.toggleBold()
  expect(serializeDocumentToMarkdown(e)).toBe('**plain one two**')
  expect(e.view.dom.querySelector('.md-source-bold')?.textContent).toBe(
    'plain one two',
  )
})

test('unset commands remove all matching pairs in a selection', () => {
  const e = open('**one** and **two**')
  e.commands.selectAll()
  e.commands.unsetBold()
  expect(serializeDocumentToMarkdown(e)).toBe('one and two')
})

test('format commands leave edge whitespace outside the delimiters', () => {
  const e = open('before word after')
  e.commands.setTextSelection({ from: 7, to: 13 })
  e.commands.toggleBold()
  expect(serializeDocumentToMarkdown(e)).toBe('before **word** after')
  expect(e.view.dom.querySelector('.md-source-bold')?.textContent).toBe('word')
})

test('code preview hides syntactic padding while source and command preserve it correctly', () => {
  const e = open('`` `tick` ``')
  expect(e.view.dom.querySelector('.md-source-code')?.textContent).toBe(
    '`tick`',
  )
  expect(serializeDocumentToMarkdown(e)).toBe('`` `tick` ``')
  e.commands.setTextSelection(5)
  e.commands.toggleCode()
  expect(e.state.doc.textContent).toBe('`tick`')
})

test('selection changes reuse the lexer results without changing JSON or content updates', () => {
  const e = open('**one** and *two* and `three`')
  const manager = e.markdown! as unknown as {
    tokenizeInline: (text: string) => unknown
  }
  const tokenize = manager.tokenizeInline.bind(manager)
  let parses = 0
  manager.tokenizeInline = (text) => {
    parses++
    return tokenize(text)
  }
  const before = e.getJSON()
  focus(e)
  for (let pos = 1; pos < e.state.doc.content.size; pos++)
    e.commands.setTextSelection(pos)
  expect(parses).toBe(0)
  expect(e.getJSON()).toEqual(before)
})

test('formatting keeps a backward text selection backward', () => {
  const e = open('word')
  e.commands.setTextSelection({ from: 5, to: 1 })
  e.commands.toggleBold()
  expect(e.state.selection.anchor).toBe(7)
  expect(e.state.selection.head).toBe(3)
})

test('typing after raw-source paste never duplicates delimiters', () => {
  const e = open('')
  e.commands.insertContent('**pasted**', { contentType: 'markdown' })
  e.commands.setTextSelection(5)
  e.view.dispatch(e.state.tr.insertText('X'))
  expect(serializeDocumentToMarkdown(e)).toBe('**paXsted**')
  expect(e.view.dom.querySelector('.md-source-bold')?.textContent).toBe(
    'paXsted',
  )
})

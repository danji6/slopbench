/// <reference types="bun-types" />
import { Markdown } from '@/lib/tiptap/extensions/markdown'
import { copyCollapsedText } from '@/lib/tiptap/paste'
import {
  serializeBlocksToMarkdown,
  serializeDocumentToMarkdown,
} from '@/lib/tiptap/serialize'
import type { JSONContent } from '@tiptap/core'
import { DOMParser } from '@tiptap/pm/model'
import { Editor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { afterEach, describe, expect, test } from 'bun:test'

import { setupDom } from '../setup/dom'

setupDom()

let editor: Editor | undefined

/** Loads markdown the way the editors do, through `contentType: 'markdown'`. */
function open(markdown: string): Editor {
  editor = new Editor({
    extensions: [StarterKit, Markdown],
    content: markdown,
    contentType: 'markdown',
  })
  return editor
}

/**
 * Reloads the document from the editor DOM, which is what ProseMirror does to
 * every block the user edits. `linebreakReplacement` turns each newline it
 * finds there into a hard break node.
 */
function reopenFromDom(source: Editor): Editor {
  const parsed = DOMParser.fromSchema(source.schema).parse(source.view.dom, {
    preserveWhitespace: true,
  })
  const content = parsed.toJSON() as JSONContent
  source.destroy()
  editor = new Editor({ extensions: [StarterKit, Markdown], content })
  return editor
}

afterEach(() => {
  editor?.destroy()
  editor = undefined
})

const roundTrip = (markdown: string) =>
  serializeDocumentToMarkdown(open(markdown))

describe('editor markdown serialization', () => {
  test('keeps angle brackets and ampersands literal', () => {
    expect(roundTrip('Use <system-reminder> tags & keep 1 < 2')).toBe(
      'Use <system-reminder> tags & keep 1 < 2',
    )
  })

  test('does not backslash-escape markdown punctuation', () => {
    expect(roundTrip('Fix the run_id in items[0]')).toBe(
      'Fix the run_id in items[0]',
    )
    expect(roundTrip('Glob: packages/**/*.ts and ~/.config')).toBe(
      'Glob: packages/**/*.ts and ~/.config',
    )
    expect(roundTrip('C:\\Users\\me')).toBe('C:\\Users\\me')
  })

  test('leaves code untouched', () => {
    expect(roundTrip('inline `a < b & c` here')).toBe('inline `a < b & c` here')
    expect(roundTrip('```ts\nconst a: Array<number> = []\n```')).toBe(
      '```ts\nconst a: Array<number> = []\n```',
    )
  })

  test('preserves emphasis marks', () => {
    expect(roundTrip('**bold** and *italic*')).toBe('**bold** and *italic*')
  })

  test('is stable across repeated edits', () => {
    const once = roundTrip('Use <system-reminder> for run_id')
    expect(roundTrip(once)).toBe(once)
  })
})

describe('editor markdown html', () => {
  test('keeps undeclared custom elements and their content', () => {
    const source = '<example>\nLorem ipsum\n</example>'
    expect(roundTrip(source)).toBe(source)
  })

  test('keeps inline custom elements', () => {
    expect(roundTrip('Wrap it in <system-reminder> tags')).toBe(
      'Wrap it in <system-reminder> tags',
    )
  })

  // Standard html used to be absorbed into the schema, which dropped every
  // attribute with it. `HtmlDecoration` renders it instead, so the source is
  // what gets stored.
  test('keeps standard html literal', () => {
    expect(roundTrip('a <strong>bold</strong> word')).toBe(
      'a <strong>bold</strong> word',
    )
  })

  test('keeps styled block html literal', () => {
    const source = '<div style="background:green">🎉 Cool 🎉</div>'
    expect(roundTrip(source)).toBe(source)
  })

  test('keeps a multi-line html block literal', () => {
    const source = '<div>\n<b>x</b>\n</div>'
    expect(roundTrip(source)).toBe(source)
    expect(serializeDocumentToMarkdown(reopenFromDom(open(source)))).toBe(
      source,
    )
  })

  test('keeps void tags literal', () => {
    expect(roundTrip('line<br>break')).toBe('line<br>break')
    expect(roundTrip('an <img src="a.png"> image')).toBe(
      'an <img src="a.png"> image',
    )
  })
})

describe('editor markdown block spacing', () => {
  const blocks = [
    '<example>',
    'Lorem ipsum',
    '</example>',
    '',
    '<example>',
    'consectetur',
    '</example>',
  ].join('\n')

  test('document serialization keeps blank lines between blocks', () => {
    expect(roundTrip(blocks)).toBe(blocks)
    expect(roundTrip('# Head\n\ntext\n\n- one\n- two')).toBe(
      '# Head\n\ntext\n\n- one\n- two',
    )
  })

  test('document serialization keeps single newlines single', () => {
    expect(roundTrip('first line\nsecond line')).toBe('first line\nsecond line')
  })

  // marked absorbs the blank line after a tag or heading into that token's own
  // `raw`, so it reached the parser with nothing left to rebuild it from.
  test('keeps the blank line that follows a block-level tag', () => {
    expect(roundTrip('<tag1>\n\n<tag2>')).toBe('<tag1>\n\n<tag2>')
    expect(roundTrip('<tag1>\n\ntest\n\n<tag2>')).toBe(
      '<tag1>\n\ntest\n\n<tag2>',
    )
    expect(roundTrip('# Head\n\ntext')).toBe('# Head\n\ntext')
  })

  test('keeps a deliberate empty line after a block-level tag', () => {
    expect(roundTrip('<tag1>\n\n\n\ntest')).toBe('<tag1>\n\n\n\ntest')
    expect(roundTrip('a\n\n\n\nb')).toBe('a\n\n\n\nb')
  })

  // Chat input maps Enter to a newline, so it collapses block spacing.
  test('block serialization still collapses paragraph breaks', () => {
    expect(serializeBlocksToMarkdown(open('a\n\nb'))).toBe('a\nb')
  })
})

describe('editor interpreter directives', () => {
  test('an eval block round-trips as plain text', () => {
    const source = ['#eval', "return getVar('x')", '#end'].join('\n')
    expect(roundTrip(source)).toBe(source)
  })

  test('preserves indentation inside an eval block', () => {
    const source = ['#eval', 'if (x) {', '    return 1', '}', '#end'].join('\n')
    expect(roundTrip(source)).toBe(source)
  })

  test('a multiline condition and its body stay one flow', () => {
    const source = [
      '#if',
      'return userCount > 1',
      '#then',
      'Additional instructions',
      '#endif',
    ].join('\n')
    expect(roundTrip(source)).toBe(source)
  })

  test('single-line directives round-trip without blank lines', () => {
    const source = ['#if userCount > 1', 'Be concise.', '#endif'].join('\n')
    expect(roundTrip(source)).toBe(source)
  })
})

describe('editor markdown trailing whitespace', () => {
  test('strips whitespace left at the end of a line', () => {
    expect(roundTrip('lorem ipsum   \n\ndolor')).toBe('lorem ipsum\n\ndolor')
    expect(roundTrip('- one  \n- two\t')).toBe('- one\n- two')
    expect(serializeBlocksToMarkdown(open('lorem   \n\ndolor  '))).toBe(
      'lorem\ndolor',
    )
  })

  test('writes hard breaks as plain newlines', () => {
    const e = open('first')
    e.commands.focus('end')
    e.commands.setHardBreak()
    e.commands.insertContent('second')
    expect(serializeDocumentToMarkdown(e)).toBe('first\nsecond')
  })

  // ProseMirror rebuilds every edited block from the DOM, turning the newlines
  // in it into hard break nodes. Serializing those as `  \n` grew two spaces
  // per line that were never typed and could not be deleted.
  test('does not grow spaces when a block is re-read from the dom', () => {
    const source = '<example>\nLorem ipsum\n</example>'
    const reopened = reopenFromDom(open(source))

    const inline = reopened.getJSON().content?.[0]?.content ?? []
    expect(inline.some((node) => node.type === 'hardBreak')).toBe(true)
    expect(serializeDocumentToMarkdown(reopened)).toBe(source)
  })

  test('keeps whitespace inside code blocks', () => {
    expect(roundTrip('```ts\nconst a = 1   \n```')).toBe(
      '```ts\nconst a = 1   \n```',
    )
    expect(roundTrip('```\ntrailing  \n```\n\ntext  ')).toBe(
      '```\ntrailing  \n```\n\ntext',
    )
  })
})

describe('clipboard text', () => {
  test('copies blocks as single newlines, hard breaks included', () => {
    const e = open('first\n\nsecond')
    e.commands.setTextSelection({ from: 0, to: e.state.doc.content.size })
    const slice = e.state.selection.content()
    expect(copyCollapsedText(slice)).toBe('first\nsecond')
  })
})

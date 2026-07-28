/// <reference types="bun-types" />
import { BlockOpeners } from '@/lib/tiptap/extensions/block-openers'
import { InterpreterInput } from '@/lib/tiptap/extensions/interpreter-input'
import { Markdown } from '@/lib/tiptap/extensions/markdown'
import { serializeDocumentToMarkdown } from '@/lib/tiptap/serialize'
import { TextSelection } from '@tiptap/pm/state'
import { Editor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { describe, expect, test } from 'bun:test'

import { setupDom } from '../setup/dom'

setupDom()

const extensions = [
  StarterKit.configure({ codeBlock: false }),
  Markdown,
  InterpreterInput,
]

/** Simulates real keystrokes, giving the plugin first refusal on each char. */
function type(editor: Editor, input: string): void {
  for (const ch of input) {
    const { from, to } = editor.state.selection
    const handled =
      editor.view.someProp('handleTextInput', (fn) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (fn as any)(editor.view, from, to, ch),
      ) === true
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(ch, from, to))
  }
}

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

/** Drops the caret at the start of the line holding `needle`. */
function caretAtLineStart(editor: Editor, needle: string): void {
  let start = -1
  editor.state.doc.descendants((node, pos) => {
    if (start < 0 && node.isText && node.text?.includes(needle)) start = pos
  })
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, start)),
  )
}

/** Presses Enter through the editor's key handlers; returns whether handled. */
function pressEnter(editor: Editor): boolean {
  const event = new KeyboardEvent('keydown', { key: 'Enter' })
  return (
    editor.view.someProp('handleKeyDown', (fn) => fn(editor.view, event)) ===
    true
  )
}

/** Presses Backspace through the editor's key handlers. */
function pressBackspace(editor: Editor): boolean {
  const event = new KeyboardEvent('keydown', { key: 'Backspace' })
  return (
    editor.view.someProp('handleKeyDown', (fn) => fn(editor.view, event)) ===
    true
  )
}

/** Drops the caret just after the first occurrence of `needle`. */
function caretAfter(editor: Editor, needle: string): void {
  let end = -1
  editor.state.doc.descendants((node, pos) => {
    if (end < 0 && node.isText && node.text) {
      const idx = node.text.indexOf(needle)
      if (idx >= 0) end = pos + idx + needle.length
    }
  })
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)),
  )
}

describe('Tab indentation in code regions', () => {
  test('Tab indents a line in an eval body', () => {
    const e = new Editor({
      extensions,
      content: paragraphs('#eval', 'return x', '#end') as never,
    })
    caretAtLineStart(e, 'return x')
    e.commands.keyboardShortcut('Tab')
    expect(serializeDocumentToMarkdown(e)).toContain('  return x')
    e.destroy()
  })

  test('Shift-Tab outdents a line in an eval body', () => {
    const e = new Editor({
      extensions,
      content: paragraphs('#eval', '    return x', '#end') as never,
    })
    caretAtLineStart(e, 'return x')
    e.commands.keyboardShortcut('Shift-Tab')
    expect(serializeDocumentToMarkdown(e)).toContain('  return x')
    expect(serializeDocumentToMarkdown(e)).not.toContain('    return x')
    e.destroy()
  })

  test('Tab leaves plain prose untouched', () => {
    const e = new Editor({
      extensions,
      content: paragraphs('just some prose') as never,
    })
    caretAtLineStart(e, 'just')
    e.commands.keyboardShortcut('Tab')
    expect(serializeDocumentToMarkdown(e)).toBe('just some prose')
    e.destroy()
  })

  test('Backspace in leading whitespace removes a whole indent unit', () => {
    const e = new Editor({
      extensions,
      content: paragraphs('#eval', '    x', '#end') as never,
    })
    caretAfter(e, '    ') // between the indent and the `x`
    pressBackspace(e)
    const md = serializeDocumentToMarkdown(e)
    expect(md).toContain('  x')
    expect(md).not.toContain('    x') // one full unit gone, not a single space
    e.destroy()
  })
})

describe('Enter auto-indent in code regions', () => {
  test('a new line keeps the current line indentation', () => {
    const e = new Editor({
      extensions,
      content: paragraphs('#eval', '    const x = 1', '#end') as never,
    })
    caretAfter(e, 'const x = 1')
    pressEnter(e)
    e.commands.insertContent('y')
    expect(serializeDocumentToMarkdown(e)).toContain('    y')
    e.destroy()
  })

  test('an opening bracket adds a level of indent', () => {
    const e = new Editor({
      extensions,
      content: paragraphs('#eval', '  if (a) {', '#end') as never,
    })
    caretAfter(e, '{')
    pressEnter(e)
    e.commands.insertContent('y')
    expect(serializeDocumentToMarkdown(e)).toContain('    y')
    e.destroy()
  })

  test('Enter in plain prose splits the block as usual', () => {
    const e = new Editor({
      extensions,
      content: paragraphs('  indented prose') as never,
    })
    caretAfter(e, 'prose')
    pressEnter(e)
    e.commands.insertContent('y')
    // No indent is carried into prose (the default split runs).
    expect(serializeDocumentToMarkdown(e)).not.toContain('  y')
    e.destroy()
  })
})

describe('#if scaffolding', () => {
  test('Enter on a bare #if scaffolds a matching #then', () => {
    const e = new Editor({
      extensions,
      content: paragraphs('#if') as never,
    })
    caretAfter(e, '#if')
    pressEnter(e)
    expect(serializeDocumentToMarkdown(e)).toBe('#if\n\n#then')
    e.destroy()
  })

  test('the caret lands on the condition line', () => {
    const e = new Editor({
      extensions,
      content: paragraphs('#elif') as never,
    })
    caretAfter(e, '#elif')
    pressEnter(e)
    e.commands.insertContent('isAdmin')
    expect(serializeDocumentToMarkdown(e)).toBe('#elif\nisAdmin\n#then')
    e.destroy()
  })

  test('Enter on an inline #if scaffolds a matching #endif', () => {
    const e = new Editor({
      extensions,
      content: paragraphs('#if userCount > 1') as never,
    })
    caretAfter(e, '> 1')
    pressEnter(e)
    e.commands.insertContent('be concise')
    const md = serializeDocumentToMarkdown(e)
    expect(md).toBe('#if userCount > 1\nbe concise\n#endif')
    expect(md).not.toContain('#then') // inline form closes with #endif, not #then
    e.destroy()
  })
})

describe('bracket/quote pairs in code regions', () => {
  test('typing a bracket auto-closes it with the caret between', () => {
    const e = new Editor({
      extensions,
      content: paragraphs('#eval', 'x', '#end') as never,
    })
    caretAfter(e, 'x')
    type(e, '{')
    type(e, 'a')
    expect(serializeDocumentToMarkdown(e)).toContain('x{a}')
    e.destroy()
  })

  test('typing over an auto-closed bracket skips instead of duplicating', () => {
    const e = new Editor({
      extensions,
      content: paragraphs('#eval', 'x', '#end') as never,
    })
    caretAfter(e, 'x')
    type(e, '{') // -> x{|}
    type(e, '}') // should step over the closer
    type(e, 'y')
    const md = serializeDocumentToMarkdown(e)
    expect(md).toContain('x{}y')
    expect(md).not.toContain('x{}}')
    e.destroy()
  })

  test('Backspace inside an empty pair removes both sides', () => {
    const e = new Editor({
      extensions,
      content: paragraphs('#eval', 'x', '#end') as never,
    })
    caretAfter(e, 'x')
    type(e, '(') // -> x(|)
    pressBackspace(e)
    const md = serializeDocumentToMarkdown(e)
    expect(md).toContain('x')
    expect(md).not.toContain('(')
    expect(md).not.toContain(')')
    e.destroy()
  })

  test('a closing bracket on an indented blank line dedents', () => {
    const e = new Editor({
      extensions,
      content: paragraphs('#eval', '  ', '#end') as never,
    })
    caretAfter(e, '  ')
    type(e, '}')
    const md = serializeDocumentToMarkdown(e)
    expect(md).toContain('}')
    expect(md).not.toContain('  }') // the indent was stripped
    e.destroy()
  })

  test('brackets do not auto-close in plain prose', () => {
    const e = new Editor({
      extensions,
      content: paragraphs('some prose') as never,
    })
    caretAfter(e, 'prose')
    type(e, '{')
    const md = serializeDocumentToMarkdown(e)
    expect(md).toContain('prose{')
    expect(md).not.toContain('{}')
    e.destroy()
  })
})

describe('#eval scaffolding', () => {
  test('typing #eval on its own line inserts a matching #end', () => {
    const e = new Editor({ extensions, content: '', contentType: 'markdown' })
    e.commands.focus()
    type(e, '#eval')
    expect(serializeDocumentToMarkdown(e)).toBe('#eval\n\n#end')
    e.destroy()
  })

  test('the caret lands on the body line, ready to type', () => {
    const e = new Editor({ extensions, content: '', contentType: 'markdown' })
    e.commands.focus()
    type(e, '#eval')
    type(e, 'return 1')
    expect(serializeDocumentToMarkdown(e)).toBe('#eval\nreturn 1\n#end')
    e.destroy()
  })

  test('does not scaffold when #eval is not alone on its line', () => {
    const e = new Editor({ extensions, content: '', contentType: 'markdown' })
    e.commands.focus()
    type(e, 'x#eval')
    expect(serializeDocumentToMarkdown(e)).toBe('x#eval')
    e.destroy()
  })
})

describe('block openers in code regions', () => {
  test('a markdown opener stays literal in an eval body', () => {
    const e = new Editor({
      extensions: [...extensions, BlockOpeners],
      content: paragraphs('#eval', 'x', '#end') as never,
    })
    caretAtLineStart(e, 'x')
    type(e, '- ')
    expect(e.state.doc.child(1).type.name).toBe('paragraph')
    expect(e.state.doc.child(1).textContent).toBe('- x')
    e.destroy()
  })

  test('a markdown opener below the body still opens its block', () => {
    const e = new Editor({
      extensions: [...extensions, BlockOpeners],
      content: paragraphs('#eval', 'x', '#end', 'after') as never,
    })
    caretAtLineStart(e, 'after')
    type(e, '- ')
    expect(serializeDocumentToMarkdown(e)).toContain('- after')
    e.destroy()
  })
})

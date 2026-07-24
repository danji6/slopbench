/// <reference types="bun-types" />
import { InterpreterInput } from '@/lib/tiptap/extensions/interpreter-input'
import { LineBreaks } from '@/lib/tiptap/extensions/line-breaks'
import { Markdown } from '@/lib/tiptap/extensions/markdown'
import { serializeDocumentToMarkdown } from '@/lib/tiptap/serialize'
import { evaluate } from '@sb/core/interpreter/evaluate'
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

function open(): Editor {
  editor = new Editor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Markdown,
      InterpreterInput,
      LineBreaks,
    ],
    content: '',
    contentType: 'markdown',
  })
  editor.commands.focus()
  return editor
}

/** Presses Enter through the editor's key handlers, as the browser does. */
function enter(e: Editor): void {
  const event = new KeyboardEvent('keydown', { key: 'Enter' })
  const handled = e.view.someProp('handleKeyDown', (fn) => fn(e.view, event))
  if (handled !== true) e.commands.keyboardShortcut('Enter')
}

/**
 * The prompt as an author types it: Enter between lines, and the `#endif`
 * scaffolded by the `#if` rather than typed.
 */
function authorPrompt(): string {
  const e = open()
  e.commands.insertContent('You are a coding assistant.')
  enter(e)
  e.commands.insertContent('#if workDir')
  enter(e) // scaffolds `#endif`, caret on the body line between
  e.commands.insertContent('The workspace is {{workDir}}')
  e.commands.focus('end')
  enter(e)
  e.commands.insertContent('Be concise.')
  return serializeDocumentToMarkdown(e)
}

/** Reopens stored markdown and stores it again, as an edit session does. */
function reopen(markdown: string): string {
  editor?.destroy()
  editor = new Editor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Markdown,
      InterpreterInput,
      LineBreaks,
    ],
    content: markdown,
    contentType: 'markdown',
  })
  return serializeDocumentToMarkdown(editor)
}

// Enter inserts a line break, so a line the author typed is one newline and a
// blank line is a blank line — both stable across save/load, which is what
// keeps a dropped directive from leaving whitespace behind.
describe('authored prompt evaluation', () => {
  test('stores what the author sees', () => {
    expect(authorPrompt()).toBe(
      [
        'You are a coding assistant.',
        '#if workDir',
        'The workspace is {{workDir}}',
        '#endif',
        'Be concise.',
      ].join('\n'),
    )
  })

  test('survives an edit session unchanged', () => {
    const stored = authorPrompt()
    expect(reopen(stored)).toBe(stored)
  })

  test('leaves no gap where a dropped block stood', () => {
    expect(evaluate(authorPrompt(), {})).toBe(
      'You are a coding assistant.\nBe concise.',
    )
  })

  test('keeps the branch on its own line when it renders', () => {
    expect(evaluate(authorPrompt(), { workDir: '/w' })).toBe(
      'You are a coding assistant.\nThe workspace is /w\nBe concise.',
    )
  })

  test('keeps a blank line the author typed', () => {
    const e = open()
    for (const line of [
      'Intro.',
      '',
      '#if false',
      'hidden',
      '#endif',
      '',
      'Outro.',
    ]) {
      if (e.state.doc.content.size > 2) enter(e)
      if (line) e.commands.insertContent(line)
    }
    const stored = serializeDocumentToMarkdown(e)
    expect(evaluate(stored, {})).toBe('Intro.\n\nOutro.')
    // The blank line is a paragraph break on reload, and still a blank line
    expect(reopen(stored)).toBe(stored)
  })
})

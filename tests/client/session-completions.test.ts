/// <reference types="bun-types" />
import { sessionCompletionSource } from '@/components/chat/prompts/session-completions'
import { Markdown } from '@/lib/tiptap/extensions/markdown'
import { TextSelection } from '@tiptap/pm/state'
import { Editor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { describe, expect, test } from 'bun:test'

import { setupDom } from '../setup/dom'

setupDom()

const extensions = [StarterKit.configure({ codeBlock: false }), Markdown]

/** A prompt editor whose lines are each their own paragraph, as Enter yields. */
function editorWith(...lines: string[]): Editor {
  return new Editor({
    extensions,
    content: {
      type: 'doc',
      content: lines.map((text) => ({
        type: 'paragraph',
        content: text ? [{ type: 'text', text }] : [],
      })),
    },
  })
}

/** Drops the caret at the end of the first text node containing `needle`. */
function caretAfter(editor: Editor, needle: string): void {
  let target = -1
  editor.state.doc.descendants((node, pos) => {
    if (target < 0 && node.isText && node.text) {
      const idx = node.text.indexOf(needle)
      if (idx >= 0) target = pos + idx + needle.length
    }
  })
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, target),
    ),
  )
}

/** The completion labels offered at the caret for `query`. */
function labelsAt(editor: Editor, needle: string, query: string): string[] {
  caretAfter(editor, needle)
  return sessionCompletionSource(editor)(query).map((c) => c.label)
}

describe('session completions across the interpreter grammar', () => {
  test('offers env entries inside an eval body on its own paragraph', () => {
    const e = editorWith('#eval', 'getV', '#end')
    expect(labelsAt(e, 'getV', 'getV')).toContain('getVar')
    e.destroy()
  })

  test('offers env entries in a single-line condition expression', () => {
    const e = editorWith('#if userC', 'body', '#endif')
    expect(labelsAt(e, 'userC', 'userC')).toContain('userCount')
    e.destroy()
  })

  test('offers env entries in a multiline condition body', () => {
    const e = editorWith('#if', 'userC', '#then', 'body', '#endif')
    expect(labelsAt(e, 'userC', 'userC')).toContain('userCount')
    e.destroy()
  })

  test('fuzzy-matches an abbreviation of an env entry', () => {
    const e = editorWith('#eval', 'gv', '#end')
    expect(labelsAt(e, 'gv', 'gv')).toContain('getVar')
    e.destroy()
  })

  test('offers nothing in ordinary prose', () => {
    const e = editorWith('just some getVar prose here')
    expect(labelsAt(e, 'getVar', 'getVar')).toEqual([])
    e.destroy()
  })
})

/// <reference types="bun-types" />
import { insertedBelowCaret } from '@/lib/tiptap/extensions/reveal-insert'
import { TextSelection } from '@tiptap/pm/state'
import { Editor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { describe, expect, test } from 'bun:test'

import { setupDom } from '../setup/dom'

setupDom()

const editor = () =>
  new Editor({ extensions: [StarterKit], content: '<p>hello</p>' })

describe('insertedBelowCaret', () => {
  test('ignores an edit made at the caret', () => {
    const e = editor()
    e.view.dispatch(
      e.state.tr.setSelection(TextSelection.create(e.state.doc, 6)),
    )
    // Typing carries the caret along, so nothing lands below it
    expect(insertedBelowCaret(e.state.tr.insertText('x', 6))).toBeNull()
    e.destroy()
  })

  test('ignores a transaction that changes nothing', () => {
    const e = editor()
    const tr = e.state.tr.setSelection(TextSelection.create(e.state.doc, 3))
    expect(insertedBelowCaret(tr)).toBeNull()
    e.destroy()
  })

  test('ignores a deletion', () => {
    const e = editor()
    expect(insertedBelowCaret(e.state.tr.delete(4, 6))).toBeNull()
    e.destroy()
  })

  test('reports the end of content inserted after the caret', () => {
    const e = editor()
    // A scaffold: text lands below the caret, which stays where it was
    const tr = e.state.tr.insertText('\nclose', 6)
    tr.setSelection(TextSelection.create(tr.doc, 6))
    expect(insertedBelowCaret(tr)).toBe(12)
    e.destroy()
  })
})

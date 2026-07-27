/// <reference types="bun-types" />
import { Markdown } from '@/lib/tiptap/extensions/markdown'
import { serializeDocumentToMarkdown } from '@/lib/tiptap/serialize'
import type { JSONContent } from '@tiptap/core'
import { Editor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { afterEach, describe, expect, test } from 'bun:test'

import { setupDom } from '../setup/dom'

setupDom()

const editors: Editor[] = []

function open(content: string | JSONContent): Editor {
  const editor = new Editor({
    extensions: [StarterKit, Markdown],
    content,
    contentType: 'markdown',
  })
  editors.push(editor)
  return editor
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
})

/** A list item whose text wraps, indented under a two-character marker. */
const wrapped =
  '1. **The draft** — nothing is persisted anywhere\n   until Save'

describe('round trip stability', () => {
  test('markdown does not survive being reparsed unchanged', () => {
    // The indent a wrapped list line is written with is not the indent it is
    // read back with, so every pass through the parser shifts it again. Editors
    // that decide "has this changed?" by comparing markdown must compare
    // against what their own editor produced, never against what was stored.
    const first = serializeDocumentToMarkdown(open(wrapped))
    const second = serializeDocumentToMarkdown(open(first))

    expect(first).not.toBe(wrapped)
    expect(second).not.toBe(first)
  })

  test('a document reopened as itself serializes to the same markdown', () => {
    // What lets a draft be recognised as spent: reopening on the document the
    // editor held, rather than on markdown it would have to parse again, leaves
    // the plan able to reach the state it was saved in.
    const editor = open(wrapped)
    const markdown = serializeDocumentToMarkdown(editor)

    const reopened = open(editor.getJSON())

    expect(serializeDocumentToMarkdown(reopened)).toBe(markdown)
  })
})

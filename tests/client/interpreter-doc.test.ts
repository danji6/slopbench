/// <reference types="bun-types" />
import { Markdown } from '@/lib/tiptap/extensions/markdown'
import { collectDocText, offsetAt } from '@/lib/tiptap/interpreter-doc'
import {
  isInCodeContext,
  scanInterpreterSyntax,
} from '@/lib/tiptap/interpreter-syntax'
import { Editor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { describe, expect, test } from 'bun:test'

import { setupDom } from '../setup/dom'

setupDom()

/** Builds a doc whose lines are each their own paragraph, as Enter produces. */
function paragraphs(...lines: string[]): Editor {
  return new Editor({
    extensions: [StarterKit.configure({ codeBlock: false }), Markdown],
    content: {
      type: 'doc',
      content: lines.map((text) => ({
        type: 'paragraph',
        content: text ? [{ type: 'text', text }] : [],
      })),
    },
  })
}

/** The tagged text slices the scanner finds over a whole document. */
function docSlices(editor: Editor): string[] {
  const { text } = collectDocText(editor.state.doc)
  return scanInterpreterSyntax(text).map(
    (t) => `${t.kind}:${text.slice(t.from, t.to)}`,
  )
}

describe('collectDocText', () => {
  test('joins sibling paragraphs with newlines', () => {
    const e = paragraphs('#eval', 'return x', '#end')
    expect(collectDocText(e.state.doc).text).toBe('#eval\nreturn x\n#end')
    e.destroy()
  })
})

describe('directives spanning separate paragraphs', () => {
  test('an eval block split across paragraphs still scans', () => {
    const e = paragraphs('#eval', 'return x', '#end')
    expect(docSlices(e)).toEqual([
      'keyword:#eval',
      'code:return x',
      'keyword:#end',
    ])
    e.destroy()
  })

  test('a multiline #if…#then split across paragraphs still scans', () => {
    const e = paragraphs(
      '#if',
      'return userCount > 1',
      '#then',
      'Body',
      '#endif',
    )
    expect(docSlices(e)).toEqual([
      'keyword:#if',
      'code:return userCount > 1',
      'keyword:#then',
      'keyword:#endif',
    ])
    e.destroy()
  })
})

describe('completion context across paragraphs', () => {
  /** Global offset just inside the given substring of the doc text. */
  function offsetInside(e: Editor, needle: string): number {
    const map = collectDocText(e.state.doc)
    const idx = map.text.indexOf(needle)
    return offsetAt(map, map.positions[idx])
  }

  test('an eval body in its own paragraph is a code context', () => {
    const e = paragraphs('#eval', 'getVar(', '#end')
    const map = collectDocText(e.state.doc)
    expect(isInCodeContext(map.text, offsetInside(e, 'getVar'))).toBe(true)
    e.destroy()
  })

  test('an unclosed eval body is still a code context while typing', () => {
    const e = paragraphs('#eval', 'getVar(')
    const map = collectDocText(e.state.doc)
    expect(isInCodeContext(map.text, offsetInside(e, 'getVar'))).toBe(true)
    e.destroy()
  })

  test('a condition body in its own paragraph is a code context', () => {
    const e = paragraphs('#if', 'userCount > 1', '#then', 'Body', '#endif')
    const map = collectDocText(e.state.doc)
    expect(isInCodeContext(map.text, offsetInside(e, 'userCount'))).toBe(true)
    // the plain branch body is not
    expect(isInCodeContext(map.text, offsetInside(e, 'Body'))).toBe(false)
    e.destroy()
  })
})

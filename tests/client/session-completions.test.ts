/// <reference types="bun-types" />
import {
  promptCompletionDocument,
  sessionCompletionSource,
} from '@/components/chat/prompts/session-completions'
import { applyCompletion } from '@/lib/completion/edits'
import { Markdown } from '@/lib/tiptap/extensions/markdown'
import { collectCompletions } from '@sb/core/code-completion/engine'
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

/** The completion labels offered at the caret after `needle`. */
async function labelsAt(editor: Editor, needle: string): Promise<string[]> {
  caretAfter(editor, needle)
  const map = promptCompletionDocument(editor)!
  const result = await collectCompletions([sessionCompletionSource], {
    text: map.text,
    offset: map.offset,
    language: 'javascript',
    trigger: 'typing',
  })
  return result.items.map((c) => c.label)
}

describe('session completions across the interpreter grammar', () => {
  test('offers model variables in eval blocks and conditions', async () => {
    for (const lines of [
      ['#eval', 'model', '#end'],
      ['#if model', 'body', '#endif'],
      ['#if', 'model', '#then', 'body', '#endif'],
      ['{{ model }}'],
    ]) {
      const e = editorWith(...lines)
      expect(await labelsAt(e, 'model')).toEqual(
        expect.arrayContaining(['modelId', 'modelName']),
      )
      e.destroy()
    }
  })

  test('offers env entries inside an eval body on its own paragraph', async () => {
    const e = editorWith('#eval', 'getV', '#end')
    expect(await labelsAt(e, 'getV')).toContain('getVar')
    e.destroy()
  })

  test('offers env entries in a single-line condition expression', async () => {
    const e = editorWith('#if userC', 'body', '#endif')
    expect(await labelsAt(e, 'userC')).toContain('userCount')
    e.destroy()
  })

  test('offers env entries in a multiline condition body', async () => {
    const e = editorWith('#if', 'userC', '#then', 'body', '#endif')
    expect(await labelsAt(e, 'userC')).toContain('userCount')
    e.destroy()
  })

  test('fuzzy-matches an abbreviation of an env entry', async () => {
    const e = editorWith('#eval', 'gv', '#end')
    expect(await labelsAt(e, 'gv')).toContain('getVar')
    e.destroy()
  })

  test('offers nothing in ordinary prose', async () => {
    const e = editorWith('just some getVar prose here')
    expect(await labelsAt(e, 'getVar')).toEqual([])
    e.destroy()
  })

  test('replaces identifier suffixes across paragraph mappings without touching prose', async () => {
    const editor = editorWith(
      'Introduction',
      '#eval',
      'modelName',
      '#end',
      'Conclusion',
    )
    try {
      caretAfter(editor, 'modelNa')
      const map = promptCompletionDocument(editor)!
      const result = await collectCompletions([sessionCompletionSource], {
        text: map.text,
        offset: map.offset,
        language: 'javascript',
        trigger: 'explicit',
      })
      const item = result.items.find((item) => item.label === 'modelName')!
      expect(map.text.slice(item.from, item.to)).toBe('modelName')
      expect(applyCompletion(editor, map, item)).toBe(true)
      expect(
        editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n'),
      ).toBe('Introduction\n#eval\nmodelName\n#end\nConclusion')
    } finally {
      editor.destroy()
    }
  })

  test('manual requests work at empty expression starts and ignore prose', async () => {
    for (const [line, needle, expected] of [
      ['{{  }}', '{{ ', true],
      ['Ordinary ', 'Ordinary ', false],
    ] as const) {
      const editor = editorWith(line)
      try {
        caretAfter(editor, needle)
        const map = promptCompletionDocument(editor)!
        const result = await collectCompletions([sessionCompletionSource], {
          text: map.text,
          offset: map.offset,
          language: 'javascript',
          trigger: 'explicit',
        })
        expect(result.items.length > 0).toBe(expected)
      } finally {
        editor.destroy()
      }
    }
  })
})

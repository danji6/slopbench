/// <reference types="bun-types" />
import {
  promptCompletionDocument,
  sessionCompletionSource,
} from '@/components/chat/prompts/session-completions'
import { applyCompletion } from '@/lib/completion/edits'
import { Markdown } from '@/lib/tiptap/extensions/markdown'
import { collectCompletions } from '@sb/core/code-completion/engine'
import type { CompletionRequest } from '@sb/core/code-completion/types'
import { TextSelection } from '@tiptap/pm/state'
import { Editor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { describe, expect, test } from 'bun:test'

import { setupDom } from '../setup/dom'

setupDom()

async function completePrompt(
  marked: string,
  trigger: CompletionRequest['trigger'] = 'explicit',
) {
  return sessionCompletionSource({
    text: marked.replace('▌', ''),
    offset: marked.indexOf('▌'),
    language: 'javascript',
    trigger,
  })
}

async function insertPrompt(marked: string, label: string) {
  const text = marked.replace('▌', '')
  const result = await completePrompt(marked)
  const item = result.items.find((item) => item.label === label)!
  expect(item).toBeDefined()
  return text.slice(0, item.from) + item.insertText + text.slice(item.to)
}

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
  test.each([
    "Introduction {{ readFile('notes.md', ▌) }} Conclusion",
    "Introduction\n#eval\nreturn readFile('notes.md', ▌)\n#end\nConclusion",
    "#if readFile('notes.md', ▌)\nBody\n#endif",
    "#if\nreturn readFile('notes.md', ▌)\n#then\nBody\n#endif",
    "#elif readFile('notes.md', ▌)\nBody\n#endif",
    "#eval\nreturn readFile('notes.md', ▌",
  ])('offers wrap choices within %s', async (source) => {
    const result = await completePrompt(source)
    expect(result.items.map((item) => item.label)).toEqual(['true', 'false'])
    expect(result.signature?.label).toBe('readFile')
    expect(result.signature?.activeParameter).toBe(1)
    expect(result.signature?.from).toBe(source.indexOf('('))
  })

  test('inserts literal booleans and complete scope options without adding quotes', async () => {
    expect(
      await insertPrompt("Intro {{ readFile('notes.md', fa▌) }} End", 'false'),
    ).toBe("Intro {{ readFile('notes.md', false) }} End")
    expect(
      await insertPrompt("{{ fileExists('notes.md', a▌) }}", 'agent'),
    ).toBe("{{ fileExists('notes.md', { scope: 'agent' }) }}")
    expect(
      await insertPrompt(
        "#eval\nreturn readFile('notes.md', true, ▌)\n#end",
        'workspace',
      ),
    ).toBe(
      "#eval\nreturn readFile('notes.md', true, { scope: 'workspace' })\n#end",
    )
  })

  test('shows parameter hints on caret movement without opening suggestions', async () => {
    const result = await completePrompt(
      "{{ fileExists('notes.md', ▌) }}",
      'selection',
    )
    expect(result.items).toEqual([])
    expect(result.signature?.label).toBe('fileExists')
    expect(result.signature?.params[1]?.description).toContain('workspace')
    expect(result.signature?.activeParameter).toBe(1)
  })

  test('offers locals only within their own code region and respects helper shadowing', async () => {
    const result = await completePrompt(
      '#eval\nconst localPath = workDir;\nreadFile(localP▌)\n#end',
    )
    expect(result.items.map((item) => item.label)).toContain('localPath')
    const other = await completePrompt(
      '#eval\nconst hidden = 1;\n#end\n{{ hi▌ }}',
    )
    expect(other.items.map((item) => item.label)).not.toContain('hidden')
    const shadowed = await completePrompt(
      '#eval\nconst readFile = () => {};\nreadFile(▌)\n#end',
    )
    expect(shadowed.signature).toBeUndefined()
  })

  test('does not suggest names in string literals, comments, or ordinary prose', async () => {
    for (const source of [
      "{{ readFile('model▌') }}",
      '#eval\n// model▌\n#end',
      'readFile("notes.md", ▌)',
      '#eval\nreturn 1\n#end\nreadFile("notes.md", ▌)',
    ]) {
      expect((await completePrompt(source)).items).toEqual([])
    }
  })

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

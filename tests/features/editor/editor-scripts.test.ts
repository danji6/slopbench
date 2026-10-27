/// <reference types="bun-types" />
import {
  SCRIPT_HELPER_NAMES,
  SCRIPT_SCOPES,
  applyScript,
} from '@/components/chat/messages/editor/apply-script'
import { SCRIPT_COMPLETIONS } from '@/components/chat/messages/editor/script-completions'
import { Markdown } from '@/lib/tiptap/extensions/markdown'
import { javascriptCompletions } from '@sb/core/code-completion/javascript'
import { Editor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { setupDom } from '~/tests/setup/dom'

setupDom()

let editor: Editor | undefined

afterEach(() => {
  editor?.destroy()
  editor = undefined
})

const cases = [
  ['selection', 'first\nmle\nlast', 'first\nmle\nlast'],
  ['paragraph', 'first\nlast', ''],
  ['message', '', ''],
  ['toEnd', 'first\nm', 'first\nm'],
  ['toStart', 'le\nlast', 'le\nlast'],
] as const

function selectedEditor(codeBlock: boolean): Editor {
  editor = new Editor({
    extensions: [StarterKit.configure({ trailingNode: false }), Markdown],
    content: codeBlock
      ? '```\nfirst\nmiddle\nlast\n```'
      : 'first\n\nmiddle\n\nlast',
    contentType: 'markdown',
  })
  // Select "idd" within the middle line or paragraph.
  const from = codeBlock ? 8 : 9
  editor.commands.setTextSelection({ from, to: from + 3 })
  return editor
}

for (const codeBlock of [false, true]) {
  describe(`editor scripts in ${codeBlock ? 'code blocks' : 'markdown'}`, () => {
    for (const argument of ['', ", ''", ', undefined']) {
      test.each(cases)(
        "replace('%s'" + argument + ') deletes its scope',
        (scope, markdown, plain) => {
          const editor = selectedEditor(codeBlock)
          applyScript(editor, `return replace('${scope}'${argument})`)

          expect(editor.getText({ blockSeparator: '\n' })).toBe(
            codeBlock ? plain : markdown,
          )
          editor.state.doc.check()
        },
      )
    }

    test.each([
      ['selection', 'first\nmXle\nlast', 'first\nmXle\nlast'],
      ['paragraph', 'first\nX\nlast', 'X'],
      ['message', 'X', 'X'],
      ['toEnd', 'first\nm\nX', 'first\nmX'],
      ['toStart', 'X\nle\nlast', 'Xle\nlast'],
    ])('replaces the %s scope', (scope, markdown, plain) => {
      const editor = selectedEditor(codeBlock)
      applyScript(editor, `return replace('${scope}', 'X')`)
      expect(editor.getText({ blockSeparator: '\n' })).toBe(
        codeBlock ? plain : markdown,
      )
      editor.state.doc.check()
    })
  })
}

test('continues to replace the selection when returning a string', () => {
  const editor = selectedEditor(false)
  applyScript(editor, 'return text.toUpperCase()')
  expect(editor.getText({ blockSeparator: '\n' })).toBe('first\nmIDDle\nlast')
})

test('coerces replacement values to strings', () => {
  const editor = selectedEditor(false)
  applyScript(editor, "return replace('message', 42)")
  expect(editor.getText()).toBe('42')
})

test.each(['', "'unknown'"])(
  'rejects a missing or unknown scope: %s',
  (argument) => {
    const editor = selectedEditor(false)
    const error = spyOn(console, 'error').mockImplementation(() => {})
    try {
      applyScript(editor, `return replace(${argument})`)
      expect(editor.getText({ blockSeparator: '\n' })).toBe(
        'first\nmiddle\nlast',
      )
      expect(error).toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  },
)

test('exposes only replace and suggests the runtime scopes', async () => {
  expect(SCRIPT_HELPER_NAMES).toEqual(['replace'])
  const result = await javascriptCompletions(SCRIPT_COMPLETIONS)({
    text: 'replace(',
    offset: 8,
    language: 'javascript',
    trigger: 'triggerCharacter',
  })
  expect(result.items.map((item) => item.label)).toEqual([...SCRIPT_SCOPES])
  expect(result.signature?.params.map((param) => param.name)).toEqual([
    'scope',
    'value',
  ])
})

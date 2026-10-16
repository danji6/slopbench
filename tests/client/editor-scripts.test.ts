/// <reference types="bun-types" />
import { applyScript } from '@/components/chat/messages/editor/apply-script'
import { Markdown } from '@/lib/tiptap/extensions/markdown'
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

const cases = [
  ['replaceSelection', 'first\nmle\nlast', 'first\nmle\nlast'],
  ['replaceParagraph', 'first\nlast', ''],
  ['replaceMessage', '', ''],
  ['replaceToEnd', 'first\nm', 'first\nm'],
  ['replaceToStart', 'le\nlast', 'le\nlast'],
] as const

for (const codeBlock of [false, true]) {
  describe(`editor script deletion in ${codeBlock ? 'code blocks' : 'markdown'}`, () => {
    for (const argument of ['', "''"]) {
      test.each(cases)(
        '%s(' + argument + ') deletes its scope',
        (helper, markdown, plain) => {
          editor = new Editor({
            extensions: [
              StarterKit.configure({ trailingNode: false }),
              Markdown,
            ],
            content: codeBlock
              ? '```\nfirst\nmiddle\nlast\n```'
              : 'first\n\nmiddle\n\nlast',
            contentType: 'markdown',
          })
          // Select "idd" within the middle line or paragraph.
          const from = codeBlock ? 8 : 9
          editor.commands.setTextSelection({ from, to: from + 3 })

          applyScript(editor, `return ${helper}(${argument})`)

          expect(editor.getText({ blockSeparator: '\n' })).toBe(
            codeBlock ? plain : markdown,
          )
          editor.state.doc.check()
        },
      )
    }
  })
}

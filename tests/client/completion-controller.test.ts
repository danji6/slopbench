import {
  CompletionController,
  type CompletionSession,
} from '@/lib/completion/controller'
import { codeCompletionDocument } from '@/lib/completion/document'
import { applyCompletion, parseSnippet } from '@/lib/completion/edits'
import { SnippetStops } from '@/lib/tiptap/extensions/snippet-stops'
import type {
  CompletionProvider,
  CompletionResult,
} from '@sb/core/code-completion/types'
import { Editor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { describe, expect, test } from 'bun:test'

import { setupDom } from '../setup/dom'

setupDom()

function content(text: string) {
  return {
    type: 'doc',
    content: [
      {
        type: 'codeBlock',
        content: text ? [{ type: 'text', text }] : [],
      },
    ],
  }
}

function createHarness() {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({
    element,
    extensions: [StarterKit.configure({ trailingNode: false }), SnippetStops],
    content: content('te'),
  })
  editor.commands.setTextSelection(3)
  editor.view.focus()
  const pending: ((result: CompletionResult) => void)[] = []
  const provider: CompletionProvider = () =>
    new Promise((resolve) => pending.push(resolve))
  let session: CompletionSession | null = null
  const controller = new CompletionController({
    editor,
    provider,
    document: codeCompletionDocument,
    language: 'javascript',
    onChange: (next) => {
      session = next
    },
  })
  const disconnect = controller.connect()
  return {
    editor,
    pending,
    controller,
    getSession: () => session,
    dispose: () => {
      disconnect()
      editor.destroy()
      element.remove()
    },
    disconnect,
  }
}

function explicit(editor: Editor) {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  )
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const result = (label: string): CompletionResult => ({
  items: [{ label, from: 0, to: 2 }],
})

describe('completion request lifecycle', () => {
  test('an earlier request cannot replace a newer result', async () => {
    const harness = createHarness()
    try {
      explicit(harness.editor)
      await tick()
      explicit(harness.editor)
      await tick()
      expect(harness.pending).toHaveLength(2)
      harness.pending[1]!(result('new'))
      await tick()
      expect(harness.getSession()?.items[0]?.label).toBe('new')
      harness.pending[0]!(result('old'))
      await tick()
      expect(harness.getSession()?.items[0]?.label).toBe('new')
    } finally {
      harness.dispose()
    }
  })

  test('content replacement invalidates pending requests even while focused', async () => {
    const harness = createHarness()
    try {
      explicit(harness.editor)
      await tick()
      harness.editor.commands.setContent(content('replacement'))
      harness.pending[0]!(result('stale'))
      await tick()
      expect(harness.getSession()).toBeNull()
      expect(harness.pending).toHaveLength(1)
    } finally {
      harness.dispose()
    }
  })

  test('disconnecting a provider prevents its pending results from reopening', async () => {
    const harness = createHarness()
    try {
      explicit(harness.editor)
      await tick()
      harness.disconnect()
      harness.pending[0]!(result('stale'))
      await tick()
      expect(harness.getSession()).toBeNull()
    } finally {
      harness.dispose()
    }
  })

  test('composition suppresses manual requests and selection changes invalidate results', async () => {
    const harness = createHarness()
    try {
      harness.editor.view.dom.dispatchEvent(
        new CompositionEvent('compositionstart'),
      )
      explicit(harness.editor)
      await tick()
      expect(harness.pending).toHaveLength(0)
      harness.editor.view.dom.dispatchEvent(
        new CompositionEvent('compositionend'),
      )
      explicit(harness.editor)
      await tick()
      harness.editor.commands.setTextSelection(1)
      harness.pending[0]!(result('stale'))
      await tick()
      expect(harness.getSession()).toBeNull()
    } finally {
      harness.dispose()
    }
  })

  test('literal insertion never interprets dollar identifiers as snippet stops', () => {
    const harness = createHarness()
    try {
      expect(
        applyCompletion(
          harness.editor,
          codeCompletionDocument(harness.editor)!,
          {
            label: '$1',
            from: 0,
            to: 2,
          },
        ),
      ).toBe(true)
      expect(harness.editor.state.doc.textContent).toBe('$1')
    } finally {
      harness.dispose()
    }
  })

  test('snippet placeholders retain their labels and final-caret ordering', () => {
    expect(parseSnippet('wrap(${2:last}, ${1:first})$0')).toEqual({
      text: 'wrap(last, first)',
      stops: [
        { start: 11, end: 16 },
        { start: 5, end: 9 },
        { start: 17, end: 17 },
      ],
    })
  })
})

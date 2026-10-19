import type { useComposerCloseGuard } from '@/hooks/chat/composer-close-guard'
import { editorKit } from '@/lib/tiptap/kit'
import { Editor } from '@tiptap/core'
import { afterEach, beforeAll, expect, test } from 'bun:test'
import { act, createRef } from 'react'
import { type Root, createRoot } from 'react-dom/client'

import { setupDom } from '../setup/dom'

setupDom()

let useCloseGuard: typeof useComposerCloseGuard
let root: Root | null = null
let editor: Editor | null = null

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  const module = await import('@/hooks/chat/composer-close-guard')
  useCloseGuard = module.useComposerCloseGuard
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  editor?.destroy()
  editor = null
  document.body.innerHTML = ''
})

function mountComposer(content = '') {
  const element = document.createElement('div')
  document.body.append(element)
  const composer = new Editor({
    element,
    extensions: editorKit(),
    content,
    contentType: 'markdown',
  })
  editor = composer
  const ref = createRef<Editor>()
  ref.current = composer
  function Probe() {
    useCloseGuard(ref)
    return null
  }
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<Probe />))
  return composer
}

function attemptsUnload() {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

test('does not prompt without a composer', () => {
  expect(attemptsUnload()).toBe(false)
})

test.each(['', '   ', '\n\n'])(
  'does not prompt for an empty focused composer (%j)',
  (content) => {
    const composer = mountComposer(content)
    composer.view.dom.focus()
    expect(composer.isFocused).toBe(true)
    expect(attemptsUnload()).toBe(false)
  },
)

test('starts guarding while writing and stops when the composer is cleared', () => {
  const composer = mountComposer()
  composer.view.dom.focus()
  composer.commands.insertContent('Unsent message')
  expect(attemptsUnload()).toBe(true)
  composer.commands.clearContent(true)
  expect(attemptsUnload()).toBe(false)
})

test('ignores an unfocused restored draft and settings input', () => {
  const composer = mountComposer('Restored message')
  expect(attemptsUnload()).toBe(false)
  composer.view.dom.focus()
  expect(attemptsUnload()).toBe(true)

  const settingsInput = document.createElement('input')
  document.body.append(settingsInput)
  settingsInput.focus()
  settingsInput.value = 'Unsaved settings'
  expect(composer.isFocused).toBe(false)
  expect(attemptsUnload()).toBe(false)

  composer.view.dom.focus()
  expect(attemptsUnload()).toBe(true)
})

test('removes the guard when the composer unmounts', () => {
  const composer = mountComposer('Message')
  composer.view.dom.focus()
  expect(attemptsUnload()).toBe(true)
  act(() => root?.unmount())
  root = null
  expect(attemptsUnload()).toBe(false)
})

test('ignores a destroyed editor', () => {
  const composer = mountComposer('Message')
  composer.view.dom.focus()
  composer.destroy()
  expect(attemptsUnload()).toBe(false)
})

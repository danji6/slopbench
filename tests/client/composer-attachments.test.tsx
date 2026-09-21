/// <reference types="bun-types" />
import type { useComposerAttachments } from '@/components/chat/composer/use-composer-attachments'
import * as draftStore from '@/lib/chat/composer-attachment-draft-store'
import type { PendingMessage } from '@/lib/chat/types'
import { editorKit } from '@/lib/tiptap/kit'
import { Editor } from '@tiptap/core'
import { afterEach, beforeAll, beforeEach, expect, spyOn, test } from 'bun:test'
import { act, createRef } from 'react'
import { type Root, createRoot } from 'react-dom/client'

import { setupDom } from '../setup/dom'

setupDom()

let useAttachments: typeof useComposerAttachments
let attachments: ReturnType<typeof useComposerAttachments>
let root: Root | null = null
let editor: Editor | null = null
let savedDraft: draftStore.ComposerAttachmentDraft[] = []
let readDraft: ReturnType<
  typeof spyOn<typeof draftStore, 'readComposerAttachmentDraft'>
>
let writeDraft: ReturnType<
  typeof spyOn<typeof draftStore, 'writeComposerAttachmentDraft'>
>

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  const module =
    await import('@/components/chat/composer/use-composer-attachments')
  useAttachments = module.useComposerAttachments
})

beforeEach(() => {
  savedDraft = []
  readDraft = spyOn(
    draftStore,
    'readComposerAttachmentDraft',
  ).mockImplementation(async () => savedDraft)
  writeDraft = spyOn(
    draftStore,
    'writeComposerAttachmentDraft',
  ).mockImplementation(async (_key, files) => {
    savedDraft = files
  })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  editor?.destroy()
  editor = null
  readDraft.mockRestore()
  writeDraft.mockRestore()
  document.body.innerHTML = ''
})

async function mount(draftKey?: string) {
  const editorRef = createRef<Editor>()
  editorRef.current = editor
  function Harness() {
    attachments = useAttachments({ draftKey, editorRef })
    return null
  }
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<Harness />))
}

function file(name = 'same.txt') {
  return new File(['identical content'], name, { type: 'text/plain' })
}

test('removing one of three identical attachments preserves the other occurrences', async () => {
  await mount()
  const original = file()
  await act(async () => {
    await attachments.addFiles([original, original, original])
  })

  const [first, middle, last] = attachments.files
  expect(new Set(attachments.files.map((item) => item.url)).size).toBe(1)
  expect(new Set(attachments.files.map((item) => item.id)).size).toBe(3)
  act(() => attachments.removeFile(middle.id))

  expect(attachments.files.map((item) => item.id)).toEqual([first.id, last.id])
  expect(attachments.fileParts.map((part) => part.id)).toEqual([
    first.id,
    last.id,
  ])
  expect(Object.keys(attachments.originalFiles)).toEqual([first.id, last.id])
  expect(attachments.originalFiles[first.id]).toBe(original)
  expect(attachments.originalFiles[last.id]).toBe(original)

  await act(async () => {
    await attachments.addFiles([original])
  })
  expect(attachments.files.slice(0, 2).map((item) => item.id)).toEqual([
    first.id,
    last.id,
  ])
  expect(new Set(attachments.files.map((item) => item.id)).size).toBe(3)
  expect(attachments.files[2].id).not.toBe(middle.id)
})

test('equal file contents retain each occurrence’s original filename and upload data', async () => {
  await mount()
  const firstFile = file('first.txt')
  const secondFile = file('second.txt')
  await act(async () => {
    await attachments.addFiles([firstFile, secondFile])
  })
  const [first, second] = attachments.fileParts

  expect(first.url).toBe(second.url)
  expect(attachments.originalFiles[first.id]).toBe(firstFile)
  expect(attachments.originalFiles[second.id]).toBe(secondFile)
  act(() => attachments.removeFile(first.id))
  expect(attachments.fileParts).toEqual([second])
  expect(attachments.originalFiles[second.id].name).toBe('second.txt')
})

test('restoring a failed pending message preserves duplicate occurrence IDs and metadata', async () => {
  await mount()
  await act(async () => {
    await attachments.addFiles([file('first.txt'), file('second.txt')])
  })
  const pending: PendingMessage = {
    content: 'retry',
    files: attachments.fileParts,
    originalFiles: attachments.originalFiles,
    pastedText: attachments.pastedText,
  }
  act(() => attachments.resetAttachments())
  expect(attachments.files).toHaveLength(0)
  act(() => attachments.restoreAttachments(pending))
  expect(attachments.files.map((item) => item.id)).toEqual(
    pending.files.map((part) => part.id),
  )
  act(() => attachments.removeFile(pending.files[1].id))
  expect(attachments.fileParts).toEqual([pending.files[0]])
  expect(attachments.originalFiles[pending.files[0].id]?.name).toBe('first.txt')
})

test('inserting one duplicate text paste uses its own position and preserves the other', async () => {
  editor = new Editor({
    extensions: editorKit({ collapseBlocks: true }),
    content: 'abcdefghij',
    contentType: 'markdown',
  })
  await mount()
  await act(async () => {
    await attachments.addLargeTextPaste('same', 2)
    await attachments.addLargeTextPaste('same', 8)
  })
  const [first, second] = attachments.files
  expect(first.url).toBe(second.url)
  expect(attachments.pastedText[first.id].position).toBe(2)
  expect(attachments.pastedText[second.id].position).toBe(8)

  act(() => attachments.insertInline(second.id))
  expect(editor.state.doc.textContent).toBe('abcdefgsamehij')
  expect(attachments.files.map((item) => item.id)).toEqual([first.id])
  expect(attachments.files[0].canInsertInline).toBe(true)
  expect(attachments.pastedText).toEqual({
    [first.id]: { text: 'same', position: 2 },
  })
  expect(Object.keys(attachments.originalFiles)).toEqual([first.id])
})

test('legacy drafts receive distinct IDs and surviving occurrences keep their IDs when saved', async () => {
  savedDraft = [
    { id: 'existing-id', file: file(), pastePosition: 2 },
    { file: file(), pastePosition: 8 },
  ]
  await mount('duplicate-draft')
  const [first, second] = attachments.files
  expect(first.id).toBe('existing-id')
  expect(second.id).toBeTruthy()
  expect(second.id).not.toBe(first.id)
  expect(first.url).toBe(second.url)
  expect(attachments.pastedText[first.id].position).toBe(2)
  expect(attachments.pastedText[second.id].position).toBe(8)

  act(() => attachments.removeFile(first.id))
  await act(async () => {
    await Bun.sleep(350)
  })
  expect(savedDraft).toHaveLength(1)
  expect(savedDraft[0].id).toBe(second.id)
  expect(savedDraft[0].pastePosition).toBe(8)

  act(() => root?.unmount())
  await mount('duplicate-draft')
  expect(attachments.files.map((item) => item.id)).toEqual([second.id])
  expect(attachments.pastedText[second.id]).toEqual({
    text: 'identical content',
    position: 8,
  })
})

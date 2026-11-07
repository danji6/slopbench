/// <reference types="bun-types" />
import type { useComposerAttachments } from '@/hooks/chat/composer-attachments'
import * as draftStore from '@/lib/chat/composer-attachment-draft-store'
import * as chatIO from '@/lib/chat/io'
import type { PendingMessage } from '@/lib/chat/types'
import { editorKit } from '@/lib/tiptap/kit'
import { Editor } from '@tiptap/core'
import { afterEach, beforeAll, beforeEach, expect, spyOn, test } from 'bun:test'
import { act, createRef } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { setupDom } from '~/tests/setup/dom'

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
  const module = await import('@/hooks/chat/composer-attachments')
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

async function mount(initialDraftKey?: string) {
  const editorRef = createRef<Editor>()
  editorRef.current = editor
  function Harness({ draftKey }: { draftKey?: string }) {
    attachments = useAttachments({ draftKey, editorRef })
    return null
  }
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const renderDraft = async (draftKey?: string) => {
    await act(async () => root?.render(<Harness draftKey={draftKey} />))
    if (!attachments.isRestored) {
      const { happyDOM } = window as unknown as {
        happyDOM: { waitUntilComplete: () => Promise<void> }
      }
      await act(() => happyDOM.waitUntilComplete())
    }
    expect(attachments.isRestored).toBe(true)
  }
  await renderDraft(initialDraftKey)
  return renderDraft
}

function file(name = 'same.txt') {
  return new File(['identical content'], name, { type: 'text/plain' })
}

test('preparing a video preserves bytes beyond the JavaScript argument limit', async () => {
  const bytes = new Uint8Array(1024 * 1024).fill(0xab)
  const video = new File([bytes], 'clip.webm', { type: 'video/webm' })
  const { part, originalFile } = await chatIO.processFileForUpload(video)
  const prefix = 'data:video/webm;base64,'

  expect(originalFile).toBe(video)
  expect(part.url.startsWith(prefix)).toBe(true)
  const decoded = Buffer.from(part.url.slice(prefix.length), 'base64')
  expect(decoded.equals(Buffer.from(bytes))).toBe(true)
})

test('overlapping file additions and text pastes append in invocation order', async () => {
  await mount()
  const first = file('first.txt')
  const ready = Promise.withResolvers<void>()
  const { part } = await chatIO.processFileForUpload(first)
  const process = spyOn(chatIO, 'processFileForUpload').mockImplementation(
    async (picked) => {
      if (picked === first) await ready.promise
      return { part: { ...part, filename: picked.name }, originalFile: picked }
    },
  )
  const pending: Promise<unknown>[] = []
  try {
    await act(async () => {
      pending.push(
        attachments.addFiles([first]),
        attachments.addLargeTextPaste('pasted text', 0),
        attachments.addFiles([file('last.txt')]),
      )
    })
    await act(async () => {
      ready.resolve()
      await Promise.all(pending)
    })

    const [firstPart, pastedPart, lastPart] = attachments.fileParts
    expect(firstPart?.filename).toBe('first.txt')
    expect(attachments.pastedText[pastedPart?.id]?.text).toBe('pasted text')
    expect(lastPart?.filename).toBe('last.txt')
  } finally {
    process.mockRestore()
  }
})

test('a drop reserves its position before its files have been read', async () => {
  await mount()
  const drop = Promise.withResolvers<File[]>()
  await act(async () => {
    const first = attachments.addFiles(drop.promise)
    const second = attachments.addFiles([file('picked.txt')])
    drop.resolve([file('dropped.txt')])
    await Promise.all([first, second])
  })

  expect(attachments.fileParts.map((part) => part.filename)).toEqual([
    'dropped.txt',
    'picked.txt',
  ])
})

test('pending drops cannot attach to or hold up the next draft', async () => {
  const renderDraft = await mount('first-draft')
  const drop = Promise.withResolvers<File[]>()
  const pending = attachments.addFiles(drop.promise)
  await renderDraft('next-draft')
  await act(async () => {
    await attachments.addFiles([file('picked.txt')])
    drop.resolve([file('stale.txt')])
    expect(await pending).toBe(false)
  })

  expect(attachments.fileParts.map((part) => part.filename)).toEqual([
    'picked.txt',
  ])
})

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

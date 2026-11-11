import type { FileItem } from '@/hooks/file-previews'
import {
  clearComposerAttachmentDraft,
  readComposerAttachmentDraft,
  writeComposerAttachmentDraft,
} from '@/lib/chat/composer-attachment-draft-store'
import { processFileForUpload } from '@/lib/chat/io'
import { buildFileItemFromPart } from '@/lib/chat/parts'
import type { PendingFilePart, PendingMessage } from '@/lib/chat/types'
import { toastError } from '@/lib/notifications'
import { generateId } from '@/lib/utils'
import type { Editor } from '@tiptap/react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { RefObject } from 'react'

type PastedText = NonNullable<PendingMessage['pastedText']>

export type ComposerFileBatch = File[] | Promise<File[]>

type AttachmentQueue = { signal: AbortSignal; tail: Promise<unknown> }

type UseComposerAttachmentsOptions = {
  draftKey?: string
  editorRef: RefObject<Editor | null>
}

/** Owns composer attachments, large-text pastes, and attachment draft effects. */
export function useComposerAttachments({
  draftKey,
  editorRef,
}: UseComposerAttachmentsOptions) {
  const [fileParts, setFileParts] = useState<PendingFilePart[]>([])
  const [originalFiles, setOriginalFiles] = useState<Record<string, File>>({})
  const [pastedText, setPastedText] = useState<PastedText>({})
  const [restoredDraftKey, setRestoredDraftKey] = useState<string | null>(null)
  const pasteIndexRef = useRef(0)
  const revision = useRef(0)
  const filePartsRef = useRef(fileParts)
  const attachmentQueue = useRef<AttachmentQueue | null>(null)

  useLayoutEffect(() => {
    const controller = new AbortController()
    attachmentQueue.current = {
      signal: controller.signal,
      tail: Promise.resolve(),
    }
    return () => controller.abort()
  }, [draftKey])

  useEffect(() => {
    filePartsRef.current = fileParts
  }, [fileParts])

  useEffect(() => {
    if (!draftKey) return
    let cancelled = false

    void restoreAttachmentDraft(draftKey).then((restored) => {
      if (cancelled) return
      if (filePartsRef.current.length === 0 && restored) {
        revision.current++
        setFileParts(restored.fileParts)
        setOriginalFiles(restored.originalFiles)
        setPastedText(restored.pastedText)
      }
      setRestoredDraftKey(draftKey)
    })

    return () => {
      cancelled = true
    }
  }, [draftKey])

  useEffect(() => {
    if (!draftKey || restoredDraftKey !== draftKey) return
    const timeout = window.setTimeout(() => {
      const attachments = fileParts.flatMap((part) => {
        const file = originalFiles[part.id]
        const pasted = pastedText[part.id]
        return file && pasted
          ? [{ id: part.id, file, pastePosition: pasted.position }]
          : []
      })
      void writeComposerAttachmentDraft(draftKey, attachments)
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [draftKey, fileParts, originalFiles, pastedText, restoredDraftKey])

  const files = useMemo<FileItem[]>(
    () =>
      fileParts.map((part) => ({
        ...buildFileItemFromPart(part, part.id),
        canInsertInline: part.id in pastedText,
      })),
    [fileParts, pastedText],
  )

  const restoreAttachments = useCallback((message: PendingMessage) => {
    revision.current++
    filePartsRef.current = message.files
    setFileParts(message.files)
    setOriginalFiles(message.originalFiles ?? {})
    setPastedText(message.pastedText ?? {})
  }, [])

  const resetAttachments = useCallback(() => {
    revision.current++
    filePartsRef.current = []
    setFileParts([])
    setOriginalFiles({})
    setPastedText({})
  }, [])

  const clearAttachmentDraft = useCallback(() => {
    if (draftKey) void clearComposerAttachmentDraft(draftKey)
  }, [draftKey])

  // Keep later picks and pastes from overtaking files still being processed.
  const enqueueAttachment = useCallback(
    <T>(add: (signal: AbortSignal) => Promise<T>, canceled: T) => {
      const queue = attachmentQueue.current
      if (!queue) return Promise.resolve(canceled)
      const { signal } = queue
      const result = queue.tail.then(() =>
        signal.aborted ? canceled : add(signal),
      )
      queue.tail = result.catch(() => undefined)
      return result
    },
    [],
  )

  const addFiles = useCallback(
    (picked: ComposerFileBatch) => {
      // Read the drop immediately, but commit it in the same queue as picks and pastes.
      const batch = Promise.resolve(picked).then(
        (files) => ({ files }),
        (error: unknown) => ({ error }),
      )
      return enqueueAttachment(async (signal) => {
        try {
          const result = await batch
          if (signal.aborted) return false
          if ('error' in result) throw result.error
          for (const file of result.files) {
            const { part, originalFile } = await processComposerFile(file)
            if (signal.aborted) return false
            revision.current++
            setFileParts((previous) => [...previous, part])
            if (originalFile) {
              setOriginalFiles((previous) => ({
                ...previous,
                [part.id]: originalFile,
              }))
            }
          }
          return result.files.length > 0
        } catch (error) {
          if (!signal.aborted) toastError(error, 'Failed to process file')
          return false
        }
      }, false)
    },
    [enqueueAttachment],
  )

  const addLargeTextPaste = useCallback(
    (text: string, position: number) => {
      const index = ++pasteIndexRef.current
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const file = new File([text], `pasted-text-${stamp}-${index}.txt`, {
        type: 'text/plain;charset=utf-8',
      })

      return enqueueAttachment(async (signal) => {
        try {
          const { part, originalFile } = await processComposerFile(file)
          if (signal.aborted) return
          revision.current++
          setFileParts((previous) => [...previous, part])
          setOriginalFiles((previous) => ({
            ...previous,
            [part.id]: originalFile ?? file,
          }))
          setPastedText((previous) => ({
            ...previous,
            [part.id]: { text, position },
          }))
        } catch (error) {
          if (!signal.aborted) toastError(error, 'Failed to attach pasted text')
        }
      }, undefined)
    },
    [enqueueAttachment],
  )

  const removeFile = useCallback((id: string) => {
    revision.current++
    setFileParts((previous) => previous.filter((item) => item.id !== id))
    setOriginalFiles((previous) => omitKey(previous, id))
    setPastedText((previous) => omitKey(previous, id))
  }, [])

  const insertInline = useCallback(
    (id: string) => {
      const saved = pastedText[id]
      const editor = editorRef.current
      if (!saved || !editor) return
      const position = Math.min(saved.position, editor.state.doc.content.size)
      editor
        .chain()
        .setTextSelection(position)
        .insertContent(
          saved.text.replace(/\r\n?/g, '\n').replace(/\n/g, '\n\n'),
          { contentType: 'markdown' },
        )
        .focus()
        .run()
      removeFile(id)
    },
    [editorRef, pastedText, removeFile],
  )

  return {
    addFiles,
    addLargeTextPaste,
    clearAttachmentDraft,
    fileParts,
    files,
    getRevision: () => revision.current,
    insertInline,
    originalFiles,
    pastedText,
    removeFile,
    resetAttachments,
    restoreAttachments,
    isRestored: !draftKey || restoredDraftKey === draftKey,
  }
}

type RestoredAttachmentDraft = {
  fileParts: PendingFilePart[]
  originalFiles: Record<string, File>
  pastedText: PastedText
}

async function restoreAttachmentDraft(
  draftKey: string,
): Promise<RestoredAttachmentDraft | null> {
  const saved = await readComposerAttachmentDraft(draftKey)
  const processed = await Promise.allSettled(
    saved.map(async ({ id, file, pastePosition }) => ({
      ...(await processComposerFile(file, id)),
      file,
      pastePosition,
    })),
  )
  const restored = processed.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  )
  if (restored.length === 0) return null

  const pastedEntries = await Promise.allSettled(
    restored.flatMap(({ part, file, pastePosition }) =>
      pastePosition === undefined
        ? []
        : [
            file
              .text()
              .then(
                (text) => [part.id, { text, position: pastePosition }] as const,
              ),
          ],
    ),
  )

  return {
    fileParts: restored.map(({ part }) => part),
    originalFiles: Object.fromEntries(
      restored.map(({ part, file }) => [part.id, file]),
    ),
    pastedText: Object.fromEntries(
      pastedEntries.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      ),
    ),
  }
}

/** Assigns an occurrence ID independently of the processed file's content. */
async function processComposerFile(file: File, id = generateId()) {
  const processed = await processFileForUpload(file)
  return { ...processed, part: { ...processed.part, id } }
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _, ...rest } = record
  return rest
}

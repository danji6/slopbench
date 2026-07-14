import type { Editor } from '@tiptap/react'
import type { TextUIPart } from 'ai'
import React, { Suspense, lazy, useLayoutEffect, useRef, useState } from 'react'

import { useMessage } from '../message-context'
import { useMessageList } from '../message-list/message-list-context'
import { SmoothText } from '../smooth-text'
import { BubbleMenu } from './menu/bubble-menu'
import { useMessageEdit, useMessageEditDraft } from './message-edit-context'

const importEditor = () =>
  import('./rich-text-editor').then((module) => ({
    default: module.RichTextEditor,
  }))

let editorChunk: ReturnType<typeof importEditor> | null = null

export function prefetchRichTextEditor(): Promise<unknown> {
  return (editorChunk ??= importEditor())
}

const RichTextEditor = lazy(prefetchRichTextEditor as typeof importEditor)

export type EditableTextProps = Omit<React.ComponentProps<'div'>, 'part'> & {
  part: TextUIPart
  /** The segment this part belongs to (0 when the message isn't split). */
  segmentIndex?: number
  /** This part's index within its segment. */
  index?: number
}

export function EditableText({
  part,
  segmentIndex,
  index,
  children,
  style,
  ...props
}: EditableTextProps) {
  const editCtx = useMessageEdit()
  const draftCtx = useMessageEditDraft()
  const msgCtx = useMessage()
  const messageList = useMessageList()
  const scrollRef = messageList?.scrollRef
  const onLayoutChange = messageList?.onLayoutChange
  const isStreaming = part.state === 'streaming'

  const editingAddress = editCtx?.editingAddress ?? null
  const isEditing =
    editCtx?.editingMessageId === msgCtx?.id &&
    (editingAddress == null ||
      (editingAddress.segmentIndex === (segmentIndex ?? 0) &&
        editingAddress.partIndex === index))
  const shouldEdit = isEditing && !isStreaming

  const [editorReady, setEditorReady] = useState(false)
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null)
  const editorRef = useRef<Editor | null>(null)

  if (!shouldEdit && editorReady) {
    setEditorReady(false)
  }

  if (!shouldEdit && editorInstance !== null) {
    setEditorInstance(null)
  }

  const prevShouldEditRef = useRef(false)
  useLayoutEffect(() => {
    if (shouldEdit && !prevShouldEditRef.current) {
      onLayoutChange?.()
    }
    prevShouldEditRef.current = !!shouldEdit
  }, [shouldEdit, onLayoutChange])

  const appliedScrollRef = useRef(0)
  const entryScrollRef = useRef(0)

  // Compensate scroll to keep the selected text visible
  useLayoutEffect(() => {
    if (!editorReady) return
    const editor = editorRef.current
    const scrollEl = scrollRef?.current
    const viewportTop = editCtx?.pendingSelection?.viewportTop
    if (!editor || !scrollEl || viewportTop === undefined) return

    try {
      const { from } = editor.state.selection
      if (from > 0) {
        const coords = editor.view.coordsAtPos(from)
        const delta = coords.top - viewportTop
        if (Math.abs(delta) > 1) {
          adjustScroll(scrollEl, delta)
          appliedScrollRef.current += delta
          entryScrollRef.current = readScroll(scrollEl)
        }
      }
    } catch {
      // coordsAtPos can throw for invalid positions, no-op
    }
  }, [editorReady, editCtx?.pendingSelection, scrollRef])

  // Reverse the entry compensation when leaving edit mode
  const wasEditingRef = useRef(false)
  useLayoutEffect(() => {
    if (shouldEdit) {
      wasEditingRef.current = true
      return
    }
    if (!wasEditingRef.current) return
    wasEditingRef.current = false

    const applied = appliedScrollRef.current
    appliedScrollRef.current = 0
    const scrollEl = scrollRef?.current
    if (!applied || !scrollEl) return

    // Only reverse if the user hasn't manually scrolled away
    if (Math.abs(readScroll(scrollEl) - entryScrollRef.current) > 2) return
    adjustScroll(scrollEl, -applied)
  }, [shouldEdit, scrollRef])

  function handleEditorReady(editor: Editor) {
    editorRef.current = editor
    setEditorInstance(editor)
    setEditorReady(true)
  }

  return (
    <div
      className="w-full"
      style={{ ...style, ...(shouldEdit ? { display: 'grid' } : {}) }}
      {...props}
    >
      {shouldEdit && editCtx ? (
        <>
          {!editorReady && (
            <div
              className="w-full"
              style={{ gridArea: '1/1', pointerEvents: 'none' }}
            >
              <SmoothText part={part} />
            </div>
          )}
          <div
            style={{
              gridArea: '1/1',
              opacity: editorReady ? 1 : 0,
            }}
          >
            <BubbleMenu editor={editorInstance ?? undefined}>
              <Suspense fallback={null}>
                <RichTextEditor
                  initialMarkdown={draftCtx!.getDraft()}
                  onChange={draftCtx!.onDraftChange}
                  onSave={editCtx.onSave}
                  onCancel={editCtx.onCancel}
                  pendingSelection={editCtx.pendingSelection}
                  onReady={handleEditorReady}
                />
              </Suspense>
            </BubbleMenu>
          </div>
        </>
      ) : (
        children
      )}
    </div>
  )
}

function adjustScroll(scrollEl: HTMLElement, delta: number) {
  if (scrollEl === document.documentElement) {
    window.scrollBy(0, delta)
  } else {
    scrollEl.scrollTop += delta
  }
}

function readScroll(scrollEl: HTMLElement): number {
  return scrollEl === document.documentElement
    ? window.scrollY
    : scrollEl.scrollTop
}

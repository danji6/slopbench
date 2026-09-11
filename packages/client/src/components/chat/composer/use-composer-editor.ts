import type { PendingMessage } from '@/lib/chat'
import { useComposerDraft } from '@/lib/chat/composer-draft-store'
import { registerFocusReturn } from '@/lib/focus-return'
import {
  serializeBlocksToMarkdown,
  setEditorMarkdown,
} from '@/lib/tiptap/serialize'
import { parseShellCommand } from '@sb/core/shell/command'
import type { Editor } from '@tiptap/react'
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import type { MouseEvent, Ref, RefObject } from 'react'

const INTERACTIVE = 'a,button,img,input,select,textarea,[contenteditable]'

/** Imperative handle exposed to parents for focusing the composer. */
export type ComposerHandle = {
  focus: (options?: FocusOptions) => void
  /** Replaces the editor content from a markdown string. */
  setContent: (markdown: string) => void
}

type UseComposerEditorOptions = {
  draftKey?: string
  editorRef: RefObject<Editor | null>
  inputRef?: Ref<ComposerHandle>
  onRestoreMessage: (message: PendingMessage) => void
  onTyping?: () => void
  restoreMessage?: PendingMessage | null
}

/** Owns composer editor state, draft restoration, and editor lifecycle effects. */
export function useComposerEditor({
  draftKey,
  editorRef,
  inputRef,
  onRestoreMessage,
  onTyping,
  restoreMessage,
}: UseComposerEditorOptions) {
  const draft = useComposerDraft(draftKey)
  const [message, setMessage] = useState('')
  const [caret, setCaret] = useState(0)
  const [shellCommand, setShellCommand] = useState<string | null>(null)
  const suppressTypingRef = useRef(false)

  const draftRef = useRef(draft)
  const onRestoreMessageRef = useRef(onRestoreMessage)
  const onTypingRef = useRef(onTyping)

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    onRestoreMessageRef.current = onRestoreMessage
  }, [onRestoreMessage])

  useEffect(() => {
    onTypingRef.current = onTyping
  }, [onTyping])

  const applyMarkdown = useCallback((editor: Editor, markdown: string) => {
    if (markdown) suppressTypingRef.current = true
    setEditorMarkdown(editor, markdown)
  }, [])

  useImperativeHandle(
    inputRef,
    () => ({
      focus: (options) => editorRef.current?.view.dom.focus(options),
      setContent: (markdown) => {
        const editor = editorRef.current
        if (editor) applyMarkdown(editor, markdown)
      },
    }),
    [applyMarkdown, editorRef],
  )

  useEffect(
    () => registerFocusReturn(() => editorRef.current?.view.dom ?? null),
    [editorRef],
  )

  const syncFromEditor = useCallback((editor: Editor) => {
    const { doc, selection } = editor.state
    setMessage(doc.textBetween(0, doc.content.size, '\n'))
    setCaret(doc.textBetween(0, selection.from, '\n').length)
    setShellCommand(editorShellCommand(editor))
  }, [])

  const restoredKeyRef = useRef<string>(undefined)
  const restoreDraft = useCallback(
    (editor: Editor) => {
      if (!draftKey || restoredKeyRef.current === draftKey) return
      restoredKeyRef.current = draftKey
      const saved = draftRef.current.read()
      if (saved && editor.isEmpty) applyMarkdown(editor, saved)
    },
    [applyMarkdown, draftKey],
  )

  useEffect(() => {
    const editor = editorRef.current
    if (editor) restoreDraft(editor)
  }, [editorRef, restoreDraft])

  const restoredMessageRef = useRef<PendingMessage | null>(null)
  const restoreFailedMessage = useCallback(
    (editor: Editor) => {
      if (!restoreMessage || restoredMessageRef.current === restoreMessage) {
        return
      }
      restoredMessageRef.current = restoreMessage
      applyMarkdown(editor, restoreMessage.content)
      onRestoreMessageRef.current(restoreMessage)
    },
    [applyMarkdown, restoreMessage],
  )

  useEffect(() => {
    const editor = editorRef.current
    if (editor) restoreFailedMessage(editor)
  }, [editorRef, restoreFailedMessage])

  const handleEditorReady = useCallback(
    (editor: Editor) => {
      editorRef.current = editor
      editor.on('update', () => {
        syncFromEditor(editor)
        draftRef.current.save(serializeBlocksToMarkdown(editor))
        if (suppressTypingRef.current) {
          suppressTypingRef.current = false
          return
        }
        if (editor.state.doc.textContent.trim().length > 0) {
          onTypingRef.current?.()
        }
      })
      editor.on('selectionUpdate', () => syncFromEditor(editor))
      restoreDraft(editor)
      restoreFailedMessage(editor)
      syncFromEditor(editor)
    },
    [editorRef, restoreDraft, restoreFailedMessage, syncFromEditor],
  )

  const handleSurfaceMouseDown = useCallback(
    (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!event.currentTarget.contains(target)) return
      if (event.button !== 0 || target.closest(INTERACTIVE)) return
      event.preventDefault()
      const editor = editorRef.current
      if (!editor) return
      editor.view.dom.focus({ preventScroll: true })
      editor.commands.focus(null, { scrollIntoView: false })
    },
    [editorRef],
  )

  const clearEditor = useCallback(() => {
    editorRef.current?.commands.clearContent(true)
    setMessage('')
    setCaret(0)
    setShellCommand(null)
    draftRef.current.clear()
  }, [editorRef])

  const setEditorText = useCallback(
    (text: string) => {
      editorRef.current?.chain().setContent(text).focus('end').run()
    },
    [editorRef],
  )

  return {
    caret,
    clearEditor,
    handleEditorReady,
    handleSurfaceMouseDown,
    message,
    setEditorText,
    shellCommand,
  }
}

/** Returns the shell command only when it occupies the leading paragraph. */
function editorShellCommand(editor: Editor): string | null {
  const { doc } = editor.state
  if (doc.firstChild?.type.name !== 'paragraph') return null
  return parseShellCommand(doc.textBetween(0, doc.content.size, '\n'))
}

import { AlertDialog } from '@/components/ui'
import { createOptionalContext } from '@/hooks/context'
import type { PartAddress } from '@/lib/chat/parts'
import type { Editor } from '@tiptap/react'
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

export type EditCaret =
  | { kind: 'text'; offset: number }
  | { kind: 'code'; blockIndex: number; offset: number }

export type PendingSelection = {
  text: string
  occurrenceIndex: number
  caret?: EditCaret
  caretOffset?: number
  scrollY?: number
  viewportTop?: number
  onEditorReady?: (editor: Editor) => void
}

export type EditOptions = {
  selectedText?: string
  occurrenceIndex?: number
  caret?: EditCaret
  caretOffset?: number
  scrollY?: number
  viewportTop?: number
  onEditorReady?: (editor: Editor) => void
  address?: PartAddress // when set, only this part is edited
}

export type MessageEditContextValue = {
  editingMessageId: string | null
  editingAddress: PartAddress | null
  completedEditRevision: number
  onSave: () => void
  onCancel: () => void
  startEditing: (messageId: string, content: string, opts?: EditOptions) => void
  pendingSelection: PendingSelection | null
}

export type MessageEditDraftContextValue = {
  getDraft: () => string
  onDraftChange: (value: string) => void
}

export const [MessageEditContext, useMessageEdit] =
  createOptionalContext<MessageEditContextValue>()

export const [MessageEditDraftContext, useMessageEditDraft] =
  createOptionalContext<MessageEditDraftContextValue>()

type PendingRequest = {
  messageId: string
  content: string
  opts?: EditOptions
}

export type MessageEditProviderProps = {
  children: React.ReactNode
  onEdit: (id: string, content: string, address?: PartAddress) => void
}

export function MessageEditProvider({
  children,
  onEdit,
}: MessageEditProviderProps) {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingAddress, setEditingAddress] = useState<PartAddress | null>(null)
  const draftRef = useRef('')
  const addressRef = useRef<PartAddress | undefined>(undefined)
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null) // prettier-ignore
  const [pendingRequest, setPendingRequest] = useState<PendingRequest | null>(null) // prettier-ignore
  const [completedEditRevision, setCompletedEditRevision] = useState(0)

  const latestRef = useRef({ editingMessageId, onEdit })
  useEffect(() => {
    latestRef.current = { editingMessageId, onEdit }
  }, [editingMessageId, onEdit])

  const clearState = useCallback(() => {
    setEditingMessageId(null)
    setEditingAddress(null)
    setPendingSelection(null)
  }, [])

  const activate = useCallback(
    (messageId: string, content: string, opts?: EditOptions) => {
      draftRef.current = content
      addressRef.current = opts?.address
      setEditingMessageId(messageId)
      setEditingAddress(opts?.address ?? null)
      setPendingSelection(
        opts && (opts.selectedText || opts.caret || opts.caretOffset != null)
          ? {
              text: opts.selectedText ?? '',
              occurrenceIndex: opts.occurrenceIndex ?? 0,
              caret: opts.caret,
              caretOffset: opts.caretOffset,
              scrollY: opts.scrollY,
              viewportTop: opts.viewportTop,
              onEditorReady: opts.onEditorReady,
            }
          : null,
      )
    },
    [],
  )

  const startEditing = useCallback(
    (messageId: string, content: string, opts?: EditOptions) => {
      if (
        latestRef.current.editingMessageId &&
        latestRef.current.editingMessageId !== messageId
      ) {
        setPendingRequest({ messageId, content, opts })
        return
      }
      startTransition(() => activate(messageId, content, opts))
    },
    [activate],
  )

  const onSave = useCallback(() => {
    const { editingMessageId: id, onEdit: edit } = latestRef.current
    if (id) {
      edit(id, draftRef.current.trim(), addressRef.current)
      setCompletedEditRevision((revision) => revision + 1)
    }
    clearState()
  }, [clearState])

  const onCancel = useCallback(() => {
    if (latestRef.current.editingMessageId) {
      setCompletedEditRevision((revision) => revision + 1)
    }
    clearState()
  }, [clearState])

  function handleConfirmSave() {
    const { editingMessageId: id, onEdit: edit } = latestRef.current
    if (id) {
      edit(id, draftRef.current.trim(), addressRef.current)
    }
    const req = pendingRequest
    setPendingRequest(null)
    clearState()
    if (req) {
      startTransition(() => activate(req.messageId, req.content, req.opts))
    } else if (id) {
      setCompletedEditRevision((revision) => revision + 1)
    }
  }

  function handleConfirmDiscard() {
    const req = pendingRequest
    setPendingRequest(null)
    clearState()
    if (req) {
      startTransition(() => activate(req.messageId, req.content, req.opts))
    } else if (latestRef.current.editingMessageId) {
      setCompletedEditRevision((revision) => revision + 1)
    }
  }

  const contextValue = useMemo<MessageEditContextValue>(
    () => ({
      editingMessageId,
      editingAddress,
      completedEditRevision,
      onSave,
      onCancel,
      startEditing,
      pendingSelection,
    }),
    [
      editingMessageId,
      editingAddress,
      completedEditRevision,
      onSave,
      onCancel,
      startEditing,
      pendingSelection,
    ],
  )

  const onDraftChange = useCallback((value: string) => {
    draftRef.current = value
  }, [])

  const getDraft = useCallback(() => draftRef.current, [])

  const draftContextValue = useMemo<MessageEditDraftContextValue>(
    () => ({ getDraft, onDraftChange }),
    [getDraft, onDraftChange],
  )

  return (
    <MessageEditContext.Provider value={contextValue}>
      <MessageEditDraftContext.Provider value={draftContextValue}>
        {children}
        <AlertDialog
          open={!!pendingRequest}
          onOpenChange={(open) => {
            if (!open) setPendingRequest(null)
          }}
        >
          <AlertDialog.Content>
            <AlertDialog.Header>
              <AlertDialog.Title>Unsaved changes</AlertDialog.Title>
              <AlertDialog.Description>
                You have unsaved changes in another message. What would you like
                to do?
              </AlertDialog.Description>
            </AlertDialog.Header>
            <AlertDialog.Footer>
              <AlertDialog.Cancel>Keep editing</AlertDialog.Cancel>
              <AlertDialog.Action
                variant="destructive"
                onClick={handleConfirmDiscard}
              >
                Discard
              </AlertDialog.Action>
              <AlertDialog.Action onClick={handleConfirmSave}>
                Save
              </AlertDialog.Action>
            </AlertDialog.Footer>
          </AlertDialog.Content>
        </AlertDialog>
      </MessageEditDraftContext.Provider>
    </MessageEditContext.Provider>
  )
}

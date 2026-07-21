import { useAbortStream, useChatStatus, useMessageStore } from '@/hooks/chat'
import { extractTextFromMessage, latestEditableUserMessageId } from '@/lib/chat'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { useMessageEdit } from '../messages/editor'
import type { MessageListHandle } from '../messages/message-list/message-list'
import { ChatShortcutsContext } from './chat-shortcuts-context'

export type ChatShortcutsProviderProps = {
  children: React.ReactNode
  messageListRef: React.RefObject<MessageListHandle | null>
  onPinToBottom?: () => void
  onAbort?: () => void
  onOpenSearch?: () => void
}

function isEditableTarget(node: EventTarget | null): boolean {
  if (!(node instanceof HTMLElement)) return false
  return (
    node.tagName === 'INPUT' ||
    node.tagName === 'TEXTAREA' ||
    node.isContentEditable
  )
}

export function ChatShortcutsProvider({
  children,
  messageListRef,
  onPinToBottom,
  onAbort,
  onOpenSearch,
}: ChatShortcutsProviderProps) {
  const store = useMessageStore()
  const editCtx = useMessageEdit()
  const status = useChatStatus()
  const abort = useAbortStream()

  const editLatestUserMessage = useCallback(() => {
    const id = latestEditableUserMessageId(store.getIds(), store.getMessage)
    if (!id) return false

    const message = store.getMessage(id)
    if (!message) return false

    const content = extractTextFromMessage(message)
    editCtx?.startEditing(id, content, { caretOffset: content.length })

    // Wait for the editor/dock layout to settle before scrolling into view
    requestAnimationFrame(() => messageListRef.current?.scrollToMessage(id))
    return true
  }, [store, editCtx, messageListRef])

  // Keep the window listener stable while still reading live state
  const latestRef = useRef({
    status,
    editingMessageId: editCtx?.editingMessageId,
    onAbort,
    onOpenSearch,
  })
  useEffect(() => {
    latestRef.current = {
      status,
      editingMessageId: editCtx?.editingMessageId,
      onAbort,
      onOpenSearch,
    }
  }, [status, editCtx?.editingMessageId, onAbort, onOpenSearch])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const { status, editingMessageId, onAbort, onOpenSearch } =
        latestRef.current

      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        (e.key === 'f' || e.key === 'F')
      ) {
        if (!onOpenSearch) return
        e.preventDefault()
        onOpenSearch()
        return
      }

      if (e.key === 'Escape') {
        if (e.defaultPrevented) return // command picker handled it
        if (editingMessageId) return // inline editor handles cancel
        if (status === 'ready') return // nothing to stop
        e.preventDefault()
        if (onAbort) onAbort()
        else abort()
        return
      }

      if (isEditableTarget(e.target) && !e.altKey) return

      switch (e.key) {
        case 'PageDown':
          e.preventDefault()
          messageListRef.current?.scrollByPage(1)
          break
        case 'PageUp':
          e.preventDefault()
          messageListRef.current?.scrollByPage(-1)
          break
        case 'Home':
          e.preventDefault()
          messageListRef.current?.followToTop()
          break
        case 'End':
          e.preventDefault()
          if (onPinToBottom) onPinToBottom()
          else messageListRef.current?.followToBottom()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [abort, messageListRef, onPinToBottom])

  const value = useMemo(
    () => ({ editLatestUserMessage }),
    [editLatestUserMessage],
  )

  return (
    <ChatShortcutsContext.Provider value={value}>
      {children}
    </ChatShortcutsContext.Provider>
  )
}

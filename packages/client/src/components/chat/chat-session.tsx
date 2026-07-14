import {
  ChatMessagesProvider,
  StreamStoreProvider,
  useAbortStream,
  useActiveSession,
  useChatError,
  useChatStatus,
  useCompact,
  useEditMessage,
  useEditMessagePart,
  useIsWorkspaceAdmin,
  useSendMessage,
  useSessionMode,
  useWorkspaceFileIndex,
} from '@/hooks/chat'
import { useNavPadding } from '@/hooks/nav-padding'
import type { PendingMessage } from '@/lib/chat'
import { ChatError, ChatWarning, RateLimitError } from '@/lib/chat/errors'
import type { PartAddress } from '@/lib/chat/parts'
import { api } from '@sb/convex/_generated/api'
import { useMutation } from 'convex/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { ChatSessionView } from './chat-session-view'
import type { ChatProps } from './chat-types'
import { MessageEditProvider } from './messages/editor'
import type { AgentItem } from './sessions/agent-combobox'
import { ShortcutsDialog } from './shortcuts'

type ChatSessionProps = Pick<ChatProps, 'width' | 'onError'> & {
  sessionId: string
  pendingMessage: PendingMessage | null
  onPendingSent: () => void
  activeAgentName?: string
  activeAgentDisplay?: AgentItem
}

export function ChatSession({ sessionId, ...props }: ChatSessionProps) {
  return (
    <ChatMessagesProvider key={sessionId}>
      <StreamStoreProvider>
        <ChatSessionContent {...props} />
      </StreamStoreProvider>
    </ChatMessagesProvider>
  )
}

type ChatSessionContentProps = Omit<ChatSessionProps, 'sessionId'>

function ChatSessionContent({
  pendingMessage,
  onPendingSent,
  activeAgentName,
  activeAgentDisplay,
  width,
  onError,
}: ChatSessionContentProps) {
  const session = useActiveSession()
  const isWorkspaceAdmin = useIsWorkspaceAdmin()
  const fileIndex = useWorkspaceFileIndex(
    session?._id,
    Boolean(session?.workspace) && isWorkspaceAdmin,
  )
  const status = useChatStatus()
  const sendMessage = useSendMessage()
  const abort = useAbortStream()
  const editMessage = useEditMessage()
  const editMessagePart = useEditMessagePart()
  const compact = useCompact()
  const { toggleMode } = useSessionMode()
  const invokeAgent = useMutation(api.chat.invokeAgent)
  const resumeAgentMessage = useMutation(api.chat.resumeAgentMessage)
  const impersonate = useMutation(api.chat.impersonate)
  const pendingProcessed = useRef(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [dismissedKeys, setDismissedKeys] = useState(() => new Set<string>())
  const streamError = useChatError(dismissedKeys)
  const [localError, setLocalError] = useState<Error | null>(null)
  const error = localError ?? streamError

  const handleError = useCallback(
    (error: unknown) => {
      const resolved = error instanceof Error ? error : new Error(String(error))
      setLocalError(resolved)
      onError?.(resolved)
    },
    [onError],
  )

  useEffect(() => {
    if (
      streamError &&
      !(streamError instanceof RateLimitError) &&
      !(streamError instanceof ChatWarning)
    ) {
      onError?.(streamError)
    }
  }, [streamError, onError])

  // EmptyChat creates the session first, then this sends the queued message.
  useEffect(() => {
    if (!pendingMessage || pendingProcessed.current || !session) return
    pendingProcessed.current = true
    sendMessage(pendingMessage).then(onPendingSent).catch(handleError)
  }, [pendingMessage, sendMessage, onPendingSent, session, handleError])

  const handleSubmit = useCallback(
    (msg: PendingMessage) => {
      setLocalError(null)
      sendMessage(msg).catch(handleError)
    },
    [sendMessage, handleError],
  )

  const handleAbort = useCallback(() => {
    abort()
    setLocalError(null)
  }, [abort])

  const handleDismissError = useCallback(() => {
    if (localError) {
      setLocalError(null)
      return
    }
    const key =
      error instanceof ChatWarning || error instanceof ChatError
        ? error.key
        : undefined
    if (key) {
      setDismissedKeys((current) => new Set(current).add(key))
    }
  }, [error, localError])

  const handleRunCommand = useCallback(
    async (name: string, argument: string, silent: boolean) => {
      if (!session) return
      setLocalError(null)
      switch (name) {
        case 'compact':
          await compact(argument)
          break
        case 'plan':
          await toggleMode('plan').catch(handleError)
          break
        case 'resume':
          await resumeAgentMessage({ sessionId: session._id }).catch(
            handleError,
          )
          break
        case 'impersonate':
          await impersonate({
            sessionId: session._id,
            extraInstructions: argument,
          }).catch(handleError)
          break
        case 'system':
        case 'assistant':
          if (argument)
            await sendMessage(
              { content: argument, files: [], ...(silent && { silent: true }) },
              name,
            ).catch(handleError)
          break
        case 'shortcuts':
          setShowShortcuts(true)
          break
      }
    },
    [
      session,
      compact,
      toggleMode,
      resumeAgentMessage,
      impersonate,
      sendMessage,
      handleError,
    ],
  )

  const handleContinueAgent = useCallback(() => {
    if (!session) return
    setLocalError(null)
    invokeAgent({ sessionId: session._id }).catch(handleError)
  }, [session, invokeAgent, handleError])

  const handleEdit = useCallback(
    (id: string, content: string, address?: PartAddress) => {
      if (address != null) editMessagePart(id, address, content)
      else editMessage(id, content)
    },
    [editMessage, editMessagePart],
  )

  return (
    <MessageEditProvider onEdit={handleEdit}>
      <ChatSessionView
        dockWidth={`min(95%, ${width ?? '800px'} - var(--spacing)*36)`}
        topPadding={useNavPadding()}
        status={status}
        error={error}
        onSubmit={handleSubmit}
        onStop={handleAbort}
        onRunCommand={handleRunCommand}
        onContinueAgent={handleContinueAgent}
        hasActiveAgent={Boolean(session?.activeAgentId)}
        activeAgentName={activeAgentName}
        activeAgentDisplay={activeAgentDisplay}
        focusComposerOnMount={Boolean(pendingMessage)}
        onDismissError={handleDismissError}
        fileIndex={fileIndex}
      />
      <ShortcutsDialog open={showShortcuts} onOpenChange={setShowShortcuts} />
    </MessageEditProvider>
  )
}

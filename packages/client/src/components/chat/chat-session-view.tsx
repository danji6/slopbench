import { useKeyboardInset } from '@/hooks'
import {
  useActiveSession,
  useAgentPrompts,
  useChatWidth,
  useIsAdmin,
  useSendCooldownUntil,
  useSessionMode,
  useStreamAwaitingApproval,
  useTypingIndicator,
  useUnseenTailActivity,
} from '@/hooks/chat'
import type { useChatStatus, useWorkspaceFileIndex } from '@/hooks/chat'
import { useHasElapsed } from '@/hooks/expiry'
import { useAtBottomSticky } from '@/hooks/scroll'
import { Result } from '@/lib'
import type { PendingMessage } from '@/lib/chat'
import { isOngoingStream } from '@/lib/chat/stream'
import { cn } from '@/lib/utils'
import { AnimatePresence } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { ChatAlert } from './chat-alert'
import { SlowModeLabel } from './chat-countdowns'
import { ChatDock } from './chat-dock'
import { ChatLayout } from './chat-layout'
import { ChatPrompts } from './chat-prompts'
import { ChatToolbar } from './chat-toolbar'
import { ChatComposer } from './composer/chat-composer'
import type { ComposerHandle } from './composer/chat-composer'
import { ComposerToolbar } from './composer/composer-toolbar'
import { TypingIndicator } from './composer/typing-indicator'
import { useMessageEdit } from './messages/editor'
import { MessageHighlightProvider } from './messages/message-highlight-context'
import { MessageList, type MessageListHandle } from './messages/message-list'
import { HistorySearchDialog, useChatSearch, useChatSearchHost } from './search'
import type { AgentItem } from './sessions/agent-combobox'
import { ChatShortcutsProvider } from './shortcuts'
import { SubagentBanner } from './subagents/subagent-banner'
import { SubagentsWidget } from './widgets/subagents-widget'
import { TerminalsWidget } from './widgets/terminals-widget'
import { ToolApprovalPicker } from './workspace/tool-approval-picker'

const DOCK_HIDE_DISTANCE = 160

type ChatSessionViewProps = {
  dockWidth: string
  topPadding: number
  status: ReturnType<typeof useChatStatus>
  error: Error | null
  onSubmit: (msg: PendingMessage) => void
  onStop: () => void
  onRunCommand: (
    name: string,
    argument: string,
    silent: boolean,
  ) => Promise<void>
  onContinueAgent: () => void
  hasActiveAgent: boolean
  activeAgentName?: string
  activeAgentDisplay?: AgentItem
  focusComposerOnMount?: boolean
  onDismissError: () => void
  fileIndex: ReturnType<typeof useWorkspaceFileIndex>
}

export function ChatSessionView({
  dockWidth,
  topPadding,
  status,
  error,
  onSubmit,
  onStop,
  onRunCommand,
  onContinueAgent,
  hasActiveAgent,
  activeAgentName,
  activeAgentDisplay,
  focusComposerOnMount,
  onDismissError,
  fileIndex,
}: ChatSessionViewProps) {
  const session = useActiveSession()
  // Sub-agent child sessions are read-only (banner instead of composer)
  const subagentParent = session?.parent

  // Composer
  const { typingUsers, notify, clearTyping, stopTyping } = useTypingIndicator(session?._id) // prettier-ignore
  const passiveSend = session?.settings?.passiveSend ?? false
  const cooldownUntil = useSendCooldownUntil()
  const cooldownElapsed = useHasElapsed(cooldownUntil)
  const sendDisabled = !!cooldownUntil && !cooldownElapsed
  const [isPinned, setPinned] = useState(false)
  const [hasContent, setHasContent] = useState(false)

  // Message editing
  const editCtx = useMessageEdit()
  const editingMessageId = editCtx?.editingMessageId ?? null
  const completedEditRevision = editCtx?.completedEditRevision ?? 0
  const isEditing = !!editingMessageId

  // Workspace
  const workspaceAvailable = Boolean(session?.workspace)
  const awaitingApproval = useStreamAwaitingApproval()
  const canApproveTools = useIsAdmin()
  const { mode, cycleMode } = useSessionMode()
  const canCycleMode = canApproveTools && workspaceAvailable
  const showApproval = awaitingApproval && canApproveTools

  // Search
  const { open: openSearch } = useChatSearch()
  const { isOpen: searchOpen, close: closeSearch } = useChatSearchHost()

  // Layout
  const [alertHeight, setAlertHeight] = useState(0)
  const keyboardInset = useKeyboardInset(16)
  const chatWidth = useChatWidth()
  const messageWidth = `min(95%, ${chatWidth}px - var(--spacing)*36)`

  const hasPrompts = useAgentPrompts().messages.length > 0

  const messageListRef = useRef<MessageListHandle>(null)
  const composerRef = useRef<ComposerHandle>(null)

  const {
    isAtBottom,
    onScroll: onMessageListScroll,
    release: releaseSticky,
  } = useAtBottomSticky(
    useCallback(() => {
      messageListRef.current?.lockScroll()
    }, []),
    { unstickDistance: DOCK_HIDE_DISTANCE },
  )

  const unseenActivity = useUnseenTailActivity(isAtBottom)
  const hasActivity = isOngoingStream(status) || unseenActivity

  const showDock = !isEditing && (isPinned || (isAtBottom && !isPinned) || hasContent) // prettier-ignore
  const pendingFocusRef = useRef(false)
  const pinToBottom = useCallback(() => {
    messageListRef.current?.followToBottom()
    if (showDock) composerRef.current?.focus({ preventScroll: true })
    else pendingFocusRef.current = true
  }, [showDock])

  useEffect(() => {
    if (showDock && pendingFocusRef.current) {
      pendingFocusRef.current = false
      composerRef.current?.focus({ preventScroll: true })
    }
  }, [showDock])

  const handledEditRevisionRef = useRef(completedEditRevision)
  // Refocus composer after editing a message
  useEffect(() => {
    if (completedEditRevision === handledEditRevisionRef.current) return
    handledEditRevisionRef.current = completedEditRevision
    if (!showDock || showApproval) return

    const frame = requestAnimationFrame(() =>
      composerRef.current?.focus({ preventScroll: true }),
    )
    return () => cancelAnimationFrame(frame)
  }, [completedEditRevision, showApproval, showDock])

  const handleSubmit = useCallback(
    (msg: PendingMessage) => {
      onSubmit(msg)
      clearTyping()
      messageListRef.current?.revealLatest()
    },
    [onSubmit, clearTyping],
  )

  const handleContentChange = useCallback(
    (has: boolean) => {
      setHasContent(has)
      // Emptying the composer cancels a pending heartbeat or
      // clears the indicator after a short grace window
      if (!has) stopTyping()
    },
    [stopTyping],
  )

  const handleAbort = useCallback(() => {
    onStop()
    if (showApproval) return
    if (showDock) {
      requestAnimationFrame(() =>
        composerRef.current?.focus({ preventScroll: true }),
      )
    } else {
      pendingFocusRef.current = true
    }
  }, [onStop, showApproval, showDock])

  function handleCycleMode() {
    Result.from(cycleMode).catch()
  }

  return (
    <ChatShortcutsProvider
      messageListRef={messageListRef}
      onPinToBottom={pinToBottom}
      onAbort={handleAbort}
      onOpenSearch={openSearch}
    >
      <MessageHighlightProvider>
        <ChatLayout
          scrollbar
          mainContent={(bottomPadding) => (
            <MessageList
              ref={messageListRef}
              className="mx-auto w-full flex-1"
              innerStyle={{ width: `calc(${messageWidth} - var(--spacing)*6)` }}
              topPadding={topPadding}
              bottomPadding={bottomPadding}
              header={hasPrompts && <ChatPrompts className="h-fit" />}
              isAtBottom={isAtBottom}
              onScrollChange={onMessageListScroll}
              onIntoViewSettle={releaseSticky}
            />
          )}
          dockHeader={(bottomPadding) => {
            const dockTop =
              keyboardInset + (showDock ? bottomPadding + alertHeight : 0)
            return (
              <>
                <div
                  className="pointer-events-none absolute inset-x-0 mx-auto flex px-2"
                  style={{ width: dockWidth, bottom: dockTop }}
                >
                  <TypingIndicator
                    names={typingUsers.map((user) => user.name)}
                    className="pointer-events-auto"
                  />
                </div>
                <AnimatePresence>
                  {(!isAtBottom || isEditing) && (
                    <ChatToolbar
                      key="chat-toolbar"
                      bottom={dockTop}
                      showScroll={!isAtBottom}
                      activity={hasActivity}
                      onScrollToBottom={pinToBottom}
                      pinnable={!isEditing}
                      pinned={isPinned}
                      onPinChange={setPinned}
                      editing={isEditing}
                      onEditSave={editCtx?.onSave}
                      onEditCancel={editCtx?.onCancel}
                      className="pointer-events-auto absolute"
                      style={{
                        right: `calc((100% - (${dockWidth})) / 2 + var(--spacing)*4)`,
                      }}
                    />
                  )}
                </AnimatePresence>
              </>
            )
          }}
          dockFooter={<SlowModeLabel className="ml-auto" />}
          showDockFooter={sendDisabled}
          dockFooterWidth={dockWidth}
          dock={
            <ChatDock
              width={dockWidth}
              hidden={!subagentParent && (isEditing || !showDock)}
              inert={!subagentParent && isEditing}
              onAlertHeightChange={setAlertHeight}
              alert={
                <ChatAlert
                  error={error}
                  onDismiss={onDismissError}
                  className="mb-1.5 w-[calc(100%-var(--spacing)*8)]"
                />
              }
            >
              {subagentParent && (
                <SubagentBanner
                  parent={subagentParent}
                  status={status}
                  onStop={onStop}
                  onScrollToBottom={() =>
                    messageListRef.current?.followToBottom()
                  }
                />
              )}
              {!subagentParent && showApproval && (
                <ToolApprovalPicker
                  restoreFocusRef={composerRef}
                  onAbort={handleAbort}
                  className="w-full"
                />
              )}
              {!subagentParent && (
                <>
                  <div className="mb-1.5 flex items-center justify-end gap-2 px-1 empty:hidden">
                    <SubagentsWidget className="bg-background/80 h-9 px-3 backdrop-blur-md" />
                    <TerminalsWidget className="bg-background/80 h-9 px-3 backdrop-blur-md" />
                  </div>
                  <ChatComposer
                    onSubmit={handleSubmit}
                    onTyping={notify}
                    onStop={onStop}
                    onRunCommand={onRunCommand}
                    onCycleMode={canCycleMode ? handleCycleMode : undefined}
                    onContinueAgent={onContinueAgent}
                    canContinueAgent={hasActiveAgent && status === 'ready'}
                    commandAvailability={{
                      hasActiveSession: true,
                      hasActiveAgent,
                    }}
                    activeAgentName={activeAgentName}
                    startContent={
                      <ComposerToolbar
                        fallbackAgent={activeAgentDisplay}
                        mode={{
                          value: mode,
                          workspaceAvailable,
                          cycle: cycleMode,
                        }}
                      />
                    }
                    onContentChange={handleContentChange}
                    status={status}
                    inputRef={composerRef}
                    focusOnMount={focusComposerOnMount ?? false}
                    fileIndex={fileIndex}
                    passiveSend={passiveSend}
                    sendDisabled={sendDisabled}
                    className={cn('w-full', showApproval && 'hidden')}
                    inert={!showDock || showApproval}
                  />
                </>
              )}
            </ChatDock>
          }
        />
        <HistorySearchDialog
          open={searchOpen}
          onClose={closeSearch}
          messageListRef={messageListRef}
        />
      </MessageHighlightProvider>
    </ChatShortcutsProvider>
  )
}

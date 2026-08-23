import { useElementHeight, useKeyboardInset } from '@/hooks'
import {
  useActiveSession,
  useAgentPrompts,
  useAvatarSize,
  useChatWidth,
  useIsAdmin,
  useSendCooldownUntil,
  useSessionApprovalMode,
  useSessionMode,
  useStreamAwaitingApproval,
  useTypingIndicator,
  useUnseenTailActivity,
} from '@/hooks/chat'
import type { useChatStatus, useWorkspaceFileIndex } from '@/hooks/chat'
import { useHasElapsed } from '@/hooks/expiry'
import { useAtBottomSticky } from '@/hooks/scroll'
import type { PendingMessage } from '@/lib/chat'
import { getDraft } from '@/lib/chat/composer-draft-store'
import {
  avatarGutter,
  avatarVars,
  columnWidth,
} from '@/lib/chat/message-geometry'
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
import { MessageSeekProvider } from './messages/message-seek-context'
import { HistorySearchDialog, useChatSearch, useChatSearchHost } from './search'
import type { AgentItem } from './sessions/agent-combobox'
import { ChatShortcutsProvider } from './shortcuts'
import { SubagentBanner } from './subagents/subagent-banner'
import { DockWidgets } from './widgets/dock-widgets'
import { ToolApprovalPicker } from './workspace/tool-approval-picker'

const DOCK_HIDE_DISTANCE = 160
/** Gap between the dock and the toolbar sitting above it. */
const DOCK_HEADER_GAP = 16

/** Bottom offset that keeps the toolbar just above the dock's contents. */
function toolbarBottom(
  docked: boolean,
  dockHeight: number,
  widgetsHeight: number,
  alertHeight: number,
) {
  if (!docked) return DOCK_HEADER_GAP
  // The toolbar shares the widgets' row, which already clears the alert
  if (widgetsHeight) return dockHeight - widgetsHeight
  return dockHeight + alertHeight + DOCK_HEADER_GAP
}

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
  const { mode, setMode } = useSessionMode()
  const approval = useSessionApprovalMode()
  const canUseWorkspace = canApproveTools && workspaceAvailable
  const showApproval = awaitingApproval && canApproveTools

  // Search
  const { open: openSearch } = useChatSearch()
  const { isOpen: searchOpen, close: closeSearch } = useChatSearchHost()

  // Layout
  const [alertHeight, setAlertHeight] = useState(0)
  const [widgetsRef, widgetsHeight] = useElementHeight<HTMLDivElement>()
  const keyboardInset = useKeyboardInset()
  const chatWidth = useChatWidth()
  const avatarSize = useAvatarSize()
  const messageStyle = {
    width: columnWidth(chatWidth, '%'),
    '--message-gutter': avatarGutter(chatWidth, avatarSize),
    ...avatarVars(avatarSize),
  } as React.CSSProperties

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

  // When an approval closes, the note draft becomes the composer content
  const prevShowApprovalRef = useRef(showApproval)
  useEffect(() => {
    const wasShowing = prevShowApprovalRef.current
    prevShowApprovalRef.current = showApproval
    if (!wasShowing || showApproval || !session) return

    const text = getDraft(session._id)
    composerRef.current?.setContent(text)
    if (text) pendingFocusRef.current = true
  }, [showApproval, session])

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
      // Emptying the composer cancels a pending heartbeat or clears the
      // indicator after a short grace window
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

  return (
    <ChatShortcutsProvider
      messageListRef={messageListRef}
      onPinToBottom={pinToBottom}
      onAbort={handleAbort}
      onOpenSearch={openSearch}
    >
      <MessageSeekProvider messageListRef={messageListRef}>
        <MessageHighlightProvider>
          <ChatLayout
            scrollbar
            bottomInset={keyboardInset}
            mainContent={(bottomPadding) => (
              <MessageList
                ref={messageListRef}
                className="mx-auto w-full flex-1"
                innerStyle={messageStyle}
                topPadding={topPadding}
                bottomPadding={bottomPadding}
                header={hasPrompts && <ChatPrompts className="h-fit" />}
                isAtBottom={isAtBottom}
                onScrollChange={onMessageListScroll}
                onIntoViewSettle={releaseSticky}
              />
            )}
            dockHeader={(bottomPadding) => {
              const dockTop = toolbarBottom(
                showDock,
                bottomPadding,
                widgetsHeight,
                alertHeight,
              )
              return (
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
                        // Mirrors the widgets' inset on the other end of the row
                        right: `calc((100% - (${dockWidth})) / 2 + var(--spacing))`,
                      }}
                    />
                  )}
                </AnimatePresence>
              )
            }}
            dockFooter={
              <div className="flex w-full">
                <TypingIndicator names={typingUsers.map((user) => user.name)} />
                <SlowModeLabel className="ml-auto" />
              </div>
            }
            showDockFooter
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
                    title={session?.title}
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
                    className="pointer-events-auto w-full"
                  />
                )}
                {!subagentParent && (
                  <>
                    <DockWidgets
                      ref={widgetsRef}
                      className={cn(showApproval && 'hidden')}
                    />
                    <ChatComposer
                      onSubmit={handleSubmit}
                      onTyping={notify}
                      onStop={onStop}
                      onRunCommand={onRunCommand}
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
                            set: setMode,
                          }}
                          approval={{
                            value: approval.mode,
                            available: canUseWorkspace,
                            toggle: approval.toggleMode,
                          }}
                        />
                      }
                      mode={{
                        value: mode,
                        workspaceAvailable,
                        set: setMode,
                      }}
                      onContentChange={handleContentChange}
                      status={status}
                      inputRef={composerRef}
                      focusOnMount={focusComposerOnMount ?? false}
                      fileIndex={fileIndex}
                      passiveSend={passiveSend}
                      sendDisabled={sendDisabled}
                      shellAvailable={canUseWorkspace}
                      draftKey={session?._id}
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
      </MessageSeekProvider>
    </ChatShortcutsProvider>
  )
}

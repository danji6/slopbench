import {
  useStreamAwaitingApproval,
  useStreamProcessingMessageId,
  useStreamStore,
} from '@/hooks/chat'
import { getToolErrorText, getToolStatus } from '@/lib/chat'
import type { SourceMessagePart } from '@/lib/chat/combine'
import type { ToolUIPart } from 'ai'
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

import { CollapsibleBlock } from '../collapsible-block'
import type { CollapsibleBlockProps } from '../collapsible-block'
import { useMessageList } from '../message-list/message-list-context'

const openStates = new Map<string, boolean>()
const openListeners = new Set<() => void>()

const subscribeToOpenStates = (listener: () => void) => {
  openListeners.add(listener)
  return () => {
    openListeners.delete(listener)
  }
}

export type ToolShellProps = Omit<
  CollapsibleBlockProps,
  'children' | 'className' | 'part'
> & {
  part: ToolUIPart
  messageId: string
  forceError?: boolean
  autoExpand?: boolean
  noErrorText?: boolean
  dense?: boolean
  className?: string
  children?: React.ReactNode
}

export function ToolShell({
  part,
  messageId,
  forceError,
  label,
  actions,
  footer,
  collapsible = true,
  autoExpand = false,
  reveal: revealProp,
  revealOnOpen,
  fullWidth = false,
  surface = false,
  noErrorText = false,
  dense = false,
  className,
  children,
  ...props
}: ToolShellProps) {
  const { status, errorText, isAwaitingApproval } = useToolPart(
    part,
    messageId,
    forceError,
  )
  const [userOpen, setUserOpen] = usePersistentOpen(messageId, part.toolCallId)

  const note = (part as { approval?: { note?: string } }).approval?.note?.trim()
  const showErrorText = Boolean(errorText) && !noErrorText
  const hasBody = Boolean(children) || showErrorText || Boolean(note)
  const open =
    isAwaitingApproval || (userOpen ?? (autoExpand || Boolean(errorText)))

  return (
    <CollapsibleBlock
      data-slot="tool-block"
      data-tool-call-id={part.toolCallId}
      collapsible={collapsible}
      shimmer={status === 'running'}
      reveal={revealProp ?? isAwaitingApproval}
      revealOnOpen={revealOnOpen}
      open={hasBody && open}
      onOpenChange={setUserOpen}
      canExpand={hasBody}
      fullWidth={fullWidth}
      surface={surface}
      dense={dense}
      className={className}
      label={label}
      actions={actions}
      footer={footer}
      {...props}
    >
      {hasBody && (
        <div className="space-y-2 px-2.5 pb-2.5">
          {children}
          {showErrorText && (
            <pre className="bg-background text-destructive overflow-x-auto rounded px-2 py-1 text-xs">
              {errorText}
            </pre>
          )}
          {note && (
            <div className="text-muted-foreground text-xs">
              <span className="font-medium">You:</span> {note}
            </div>
          )}
        </div>
      )}
    </CollapsibleBlock>
  )
}

/** Opens a tool block from outside the message list. */
export function openToolBlock(
  messageId: string,
  toolCallId: string | undefined,
) {
  if (!toolCallId) return
  const key = openStateKey(messageId, toolCallId)
  if (openStates.get(key) === true) return
  openStates.set(key, true)
  openListeners.forEach((listener) => listener())
}

export type ToolStatus = 'pending' | 'running' | 'complete' | 'error'

export type ToolPartState = {
  status: ToolStatus
  errorText: string | undefined
  isAwaitingApproval: boolean
}

export function useToolPart(
  part: ToolUIPart,
  messageId: string,
  forceError?: boolean,
): ToolPartState {
  const awaitingApproval = useStreamAwaitingApproval()
  const processingMessageId = useStreamProcessingMessageId()
  const streamStore = useStreamStore()
  const sourceMessageId =
    (part as SourceMessagePart).sourceMessageId ?? messageId
  const messageList = useMessageList()

  const isAwaitingApproval =
    part.state === 'approval-requested' &&
    awaitingApproval &&
    processingMessageId === sourceMessageId

  const wasAwaitingApprovalRef = useRef(isAwaitingApproval)
  // Resume following once the approval resolves, but only when the turn
  // continues (approve/deny)
  useEffect(() => {
    if (wasAwaitingApprovalRef.current && !isAwaitingApproval) {
      const status = streamStore.getRawStatus()
      const turnContinues =
        status === 'pending' || status === 'streaming' || status === 'retrying'
      if (turnContinues) messageList?.resumeFollow()
    }
    wasAwaitingApprovalRef.current = isAwaitingApproval
  }, [isAwaitingApproval, messageList, streamStore])

  return {
    status: forceError ? 'error' : getToolStatus(part),
    errorText: getToolErrorText(part),
    isAwaitingApproval,
  }
}

/**
 * Keeps the block open when the user expands it.
 * null follows the block's own `autoExpand`.
 */
function openStateKey(messageId: string, toolCallId: string): string {
  return `${messageId}\0${toolCallId}`
}

function usePersistentOpen(messageId: string, toolCallId: string) {
  const key = openStateKey(messageId, toolCallId)
  const userOpen = useSyncExternalStore(
    subscribeToOpenStates,
    () => openStates.get(key) ?? null,
    () => null,
  )
  const setUserOpen = useCallback(
    (open: boolean) => {
      if (openStates.get(key) === open) return
      openStates.set(key, open)
      openListeners.forEach((listener) => listener())
    },
    [key],
  )
  return [userOpen, setUserOpen] as const
}

import {
  useStreamAwaitingApproval,
  useStreamProcessingMessageId,
} from '@/hooks/chat'
import { getToolErrorText, getToolStatus } from '@/lib/chat'
import type { SourceMessagePart } from '@/lib/chat/combine'
import type { ToolUIPart } from 'ai'
import { useCallback, useEffect, useRef, useState } from 'react'

import { CollapsibleBlock } from '../collapsible-block'
import type { CollapsibleBlockProps } from '../collapsible-block'
import { useMessageList } from '../message-list/message-list-context'

const openStates = new Map<string, boolean>()

function usePersistentOpen(id: string) {
  const [userOpen, setOpenState] = useState<boolean | null>(
    () => openStates.get(id) ?? null,
  )
  const setUserOpen = useCallback(
    (open: boolean) => {
      openStates.set(id, open)
      setOpenState(open)
    },
    [id],
  )
  return [userOpen, setUserOpen] as const
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
  const sourceMessageId =
    (part as SourceMessagePart).sourceMessageId ?? messageId
  const messageList = useMessageList()

  const isAwaitingApproval =
    part.state === 'approval-requested' &&
    awaitingApproval &&
    processingMessageId === sourceMessageId

  const wasAwaitingApprovalRef = useRef(isAwaitingApproval)
  // Resume following once the approval resolves
  useEffect(() => {
    if (wasAwaitingApprovalRef.current && !isAwaitingApproval) {
      messageList?.resumeFollow()
    }
    wasAwaitingApprovalRef.current = isAwaitingApproval
  }, [isAwaitingApproval, messageList])

  return {
    status: forceError ? 'error' : getToolStatus(part),
    errorText: getToolErrorText(part),
    isAwaitingApproval,
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
  const [userOpen, setUserOpen] = usePersistentOpen(part.toolCallId)

  const note = (part as { approval?: { note?: string } }).approval?.note?.trim()
  const showErrorText = Boolean(errorText) && !noErrorText
  const hasBody = Boolean(children) || showErrorText || Boolean(note)
  const open =
    isAwaitingApproval || (userOpen ?? (autoExpand || Boolean(errorText)))

  return (
    <CollapsibleBlock
      data-slot="tool-block"
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

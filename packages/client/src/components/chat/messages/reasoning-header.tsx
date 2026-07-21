import { Accordion, Button } from '@/components/ui'
import type { MessageRole } from '@/lib/chat'
import { cn } from '@/lib/utils'
import type { ReasoningPart } from '@sb/convex/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useGrowOnly } from './grow-only'
import { MessageHeader, type MessageSender } from './message-header'
import { useMessageHighlight } from './message-highlight-context'
import { useMessageList } from './message-list/message-list-context'
import { useReasoningLabel } from './reasoning-label'
import { SmoothText } from './smooth-text'

export type ReasoningHeaderProps = {
  sender: MessageSender
  role: MessageRole
  part: ReasoningPart
  messageId: string
  segmentIndex: number
  groupIndex: number
}

export function ReasoningHeader({
  sender,
  role,
  part,
  messageId,
  segmentIndex,
  groupIndex,
}: ReasoningHeaderProps) {
  const { label, isStreaming } = useReasoningLabel(part)
  const [open, setOpen] = useState(false)
  const messageList = useMessageList()

  const registerElement = useMessageHighlight()?.registerElement

  const target = useMemo(
    () => ({ messageId, segmentIndex, groupIndex }),
    [messageId, segmentIndex, groupIndex],
  )

  const highlightRef = useCallback(
    (element: HTMLElement | null) => {
      registerElement?.(target, element)
    },
    [target, registerElement],
  )

  const hasText = part.text.trim().length > 0
  const showBody = open && hasText

  // Let the enclosing grow-only row shrink back as the body collapses
  const release = useGrowOnly()?.release
  const wasShowing = useRef(showBody)
  useEffect(() => {
    if (wasShowing.current && !showBody) release?.()
    wasShowing.current = showBody
  }, [showBody, release])

  const toggle = useCallback(() => {
    setOpen((value) => !value)
    messageList?.onLayoutChange()
  }, [messageList])

  return (
    <div
      ref={showBody ? highlightRef : undefined}
      data-slot="reasoning-surface"
      data-open={showBody}
      className="data-[open=true]:bg-m3-surface-container-low data-[open=true]:border-border w-full border border-transparent transition-all data-[open=true]:rounded-2xl data-[open=true]:px-3 data-[open=true]:py-2"
    >
      <MessageHeader
        sender={sender}
        role={role}
        extra={
          <Button
            ref={showBody ? undefined : highlightRef}
            variant="plain"
            size={null}
            onClick={hasText ? toggle : undefined}
            data-slot="reasoning-highlight"
            className="flex min-h-0 min-w-0 items-center justify-start gap-1 rounded-none py-0 text-left focus-visible:ring-0"
          >
            <span
              className={cn(
                'min-w-0 text-xs wrap-anywhere',
                isStreaming ? 'text-shimmer' : 'text-muted-foreground',
              )}
            >
              {label}
            </span>
            {hasText && (
              <Accordion.Icon
                isExpanded={open}
                className="text-muted-foreground shrink-0"
              />
            )}
          </Button>
        }
      />
      <div
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-200 ease-in-out',
          showBody ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        style={{ gridTemplateRows: showBody ? '1fr' : '0fr' }}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className="pt-2 wrap-break-word whitespace-pre-wrap opacity-70"
            style={{
              fontFamily: 'var(--chat-font-family)',
              fontSize: 'var(--chat-font-size)',
            }}
          >
            <SmoothText part={part} />
          </div>
        </div>
      </div>
    </div>
  )
}

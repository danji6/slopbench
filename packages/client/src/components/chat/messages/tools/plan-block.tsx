import { MarkdownRenderer } from '@/components/markdown/renderer'
import {
  useActiveSession,
  useMathMode,
  useStreamProcessingMessageId,
} from '@/hooks/chat'
import type { SourceMessagePart } from '@/lib/chat/combine'
import { api } from '@sb/convex/_generated/api'
import type { ToolUIPart } from 'ai'
import { useQuery } from 'convex/react'
import { useLayoutEffect, useRef } from 'react'

import { useMessageList } from '../message-list/message-list-context'
import { useScrollIntoView } from '../scroll-into-view'
import { ToolShell, useToolPart } from './tool-shell'

const PLAN_TOOL_LABELS: Record<string, string> = {
  write_plan: 'Write plan',
  edit_plan: 'Edit plan',
  enter_plan_mode: 'Enter plan mode',
  exit_plan_mode: 'Present plan',
}

const PRE_APPROVAL_STATES: ReadonlySet<string> = new Set([
  'input-streaming',
  'input-available',
  'approval-requested',
])

export function PlanBlock({
  part,
  messageId,
  forceError,
}: {
  part: ToolUIPart
  messageId: string
  forceError?: boolean
}) {
  const toolName = part.type.slice('tool-'.length)
  const session = useActiveSession()
  const { isAwaitingApproval } = useToolPart(part, messageId, forceError)
  const processingMessageId = useStreamProcessingMessageId()
  const plan = useQuery(
    api.plans.get,
    session && toolName === 'exit_plan_mode'
      ? { sessionId: session._id }
      : 'skip',
  )
  const edits = (part.input as { edits?: unknown[] } | undefined)?.edits
  const editCount = toolName === 'edit_plan' ? (edits?.length ?? 0) : 0

  if (toolName === 'exit_plan_mode' && plan) {
    const sourceMessageId =
      (part as SourceMessagePart).sourceMessageId ?? messageId

    const expectsApproval =
      processingMessageId === sourceMessageId &&
      PRE_APPROVAL_STATES.has(part.state) &&
      plan.status !== 'approved' &&
      !!plan.content.trim()

    return (
      <PresentedPlan
        content={plan.content}
        reveal={isAwaitingApproval}
        holdFollow={expectsApproval}
      />
    )
  }

  return (
    <ToolShell
      data-slot="plan-block"
      part={part}
      messageId={messageId}
      forceError={forceError}
      label={
        <span className="text-foreground font-medium">
          {PLAN_TOOL_LABELS[toolName] ?? toolName}
          {editCount > 0 && (
            <span className="text-muted-foreground font-normal">
              {' '}
              ({editCount} {editCount === 1 ? 'change' : 'changes'})
            </span>
          )}
        </span>
      }
    />
  )
}

function PresentedPlan({
  content,
  reveal,
  holdFollow,
}: {
  content: string
  reveal: boolean
  holdFollow: boolean
}) {
  const mathMode = useMathMode()
  const blockRef = useRef<HTMLDivElement>(null)
  const messageList = useMessageList()

  const releaseFollow = messageList?.releaseFollow
  // Release the follow before paint
  useLayoutEffect(() => {
    if (holdFollow) releaseFollow?.()
  }, [holdFollow, releaseFollow])

  // Plans are read from the top, so align the start below the nav
  useScrollIntoView({
    active: reveal,
    revealOnMount: true,
    align: 'start',
    behavior: 'smooth',
    blockRef,
    scrollRef: messageList?.scrollRef,
    onBeforeScroll: messageList?.releaseFollow,
    bottomPadding: messageList?.bottomPadding ?? 0,
    topPadding: messageList?.topPadding ?? 0,
  })

  return (
    <div
      ref={blockRef}
      data-slot="plan-block"
      className="bg-m3-surface-container-low w-full rounded-xl border p-4"
    >
      <MarkdownRenderer mathMode={mathMode}>{content}</MarkdownRenderer>
    </div>
  )
}

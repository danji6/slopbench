import { ConfirmDialog, ContextMenu } from '@/components/ui'
import {
  useActiveSession,
  useDeleteMessage,
  useDeleteMessagesFrom,
  useHasNewerMessages,
  useUserProfile,
} from '@/hooks/chat'
import {
  canMutateMessage,
  extractTextFromMessage,
  messageExtra,
} from '@/lib/chat'
import type { MessageRecord } from '@/lib/chat'
import { cn, isTouchDevice } from '@/lib/utils'
import type { UIMessage } from 'ai'
import type { LucideIcon } from 'lucide-react'
import {
  AlarmClockIcon,
  CopyIcon,
  EyeOffIcon,
  ListTodoIcon,
  Trash2Icon,
} from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'

import { useMessageHighlight } from './message-highlight-context'

type ChipPresentation = {
  icon: LucideIcon
  label: string
  /** What the delete confirmation calls the message. */
  noun: string
}

function chipPresentation(record: MessageRecord | undefined): ChipPresentation {
  switch (record?.type) {
    case 'reminder': {
      const name = messageExtra(record, 'reminder')?.name
      return {
        icon: AlarmClockIcon,
        label: name ? `Reminder • ${name}` : 'Reminder',
        noun: 'reminder',
      }
    }
    case 'todo':
      return {
        icon: ListTodoIcon,
        label: 'Todo reminder',
        noun: 'reminder',
      }
    default:
      return { icon: EyeOffIcon, label: 'Hidden message', noun: 'message' }
  }
}

export type HiddenChipProps = {
  message: UIMessage
  record?: MessageRecord
}

/** Compact row for a hidden message, styled by its type. */
export function HiddenChip({ message, record }: HiddenChipProps) {
  const session = useActiveSession()
  const profile = useUserProfile()
  const deleteMessage = useDeleteMessage()
  const deleteMessagesFrom = useDeleteMessagesFrom()
  const hasNewer = useHasNewerMessages(message.id)
  const highlight = useMessageHighlight()
  const [confirm, setConfirm] = useState(false)
  const ownsHighlightRef = useRef(false)

  const canMutate = canMutateMessage(message, record, session, profile)
  const { icon: Icon, label, noun } = chipPresentation(record)

  const highlightTarget = useMemo(
    () => ({ messageId: message.id, segmentIndex: null, groupIndex: null }),
    [message.id],
  )
  const highlightRef = useCallback(
    (element: HTMLDivElement | null) => {
      highlight?.registerElement(highlightTarget, element)
    },
    [highlight, highlightTarget],
  )

  function handleOpenChange(open: boolean) {
    if (!highlight) return
    if (open) {
      ownsHighlightRef.current = true
      highlight.setTarget(highlightTarget)
    } else if (ownsHighlightRef.current) {
      ownsHighlightRef.current = false
      highlight.setTarget(null)
    }
  }

  const chip = (
    <div
      ref={highlightRef}
      data-slot="hidden-chip"
      data-message-id={message.id}
      className={cn(
        'text-muted-foreground bg-muted/50 inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs select-none',
        isTouchDevice() && '[-webkit-touch-callout:none]',
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </div>
  )

  if (!canMutate) return chip

  return (
    <>
      <ContextMenu onOpenChange={handleOpenChange}>
        <ContextMenu.Trigger>{chip}</ContextMenu.Trigger>
        <ContextMenu.Content>
          <ContextMenu.Item
            onSelect={() => {
              navigator.clipboard
                .writeText(extractTextFromMessage(message))
                .catch(() => {})
            }}
          >
            <CopyIcon />
            Copy Content
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item
            variant="destructive"
            onSelect={() => setConfirm(true)}
          >
            <Trash2Icon />
            Delete
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu>

      <ConfirmDialog
        open={confirm}
        onOpenChange={(open) => !open && setConfirm(false)}
        variant="destructive"
        title={`Delete this ${noun}?`}
        description={
          hasNewer
            ? '"Delete all" also removes every later message in this session. This action cannot be undone.'
            : 'This action cannot be undone.'
        }
        confirmText="Delete"
        extraAction={
          hasNewer
            ? {
                text: 'Delete all',
                variant: 'destructive',
                onConfirm: () => deleteMessagesFrom(message.id),
              }
            : undefined
        }
        onConfirm={() => deleteMessage(message.id)}
      />
    </>
  )
}

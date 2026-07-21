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
import type { MessageExtra } from '@sb/convex/types'
import type { UIMessage } from 'ai'
import type { LucideIcon } from 'lucide-react'
import {
  AlarmClockIcon,
  CopyIcon,
  EyeOffIcon,
  FolderSyncIcon,
  HourglassIcon,
  ListTodoIcon,
  TerminalIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'

import { useMessageHighlight } from './message-highlight-context'

type ChipPresentation = {
  icon: LucideIcon
  label: string
  /** What the delete confirmation calls the message. */
  noun: string
  /** Copied instead of the message parts, for chips that carry none. */
  copyText?: string
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
    case 'workspace': {
      const label = messageExtra(record, 'workspace')?.label
      return {
        icon: FolderSyncIcon,
        label: label ? `Workspace • ${label}` : 'Workspace unbound',
        noun: 'note',
      }
    }
    case 'command':
      return commandPresentation(messageExtra(record, 'command'))
    default:
      return { icon: EyeOffIcon, label: 'Hidden message', noun: 'message' }
  }
}

/** A command chip reads as its invocation, prefixed by what became of it. */
function commandPresentation(
  command: MessageExtra['command'] | undefined,
): ChipPresentation {
  const invocation = command
    ? `/${command.name}${command.argument ? ` ${command.argument}` : ''}`
    : 'Command'
  const base = { noun: 'command', copyText: invocation }

  switch (command?.status) {
    case 'queued':
      return { ...base, icon: HourglassIcon, label: `Queued • ${invocation}` }
    case 'failed':
      return {
        ...base,
        icon: TriangleAlertIcon,
        label: command.error
          ? `${invocation} — ${command.error}`
          : `Failed • ${invocation}`,
      }
    default:
      return { ...base, icon: TerminalIcon, label: invocation }
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
  const { icon: Icon, label, noun, copyText } = chipPresentation(record)

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
                .writeText(copyText ?? extractTextFromMessage(message))
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

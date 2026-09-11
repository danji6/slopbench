import { getToolErrorText, getToolStatus } from '@/lib/chat'
import { cn } from '@/lib/utils'
import {
  ATTACHMENT_READ_DEFAULT_BYTES,
  ATTACHMENT_READ_MAX_BYTES,
} from '@sb/core/const'
import type { ToolUIPart } from 'ai'
import { FileTextIcon } from 'lucide-react'

type ReadAttachmentInput = { offset?: number; limit?: number }

/** Renders attachment range reads without exposing their URL or contents. */
export function ReadAttachmentBlock({
  parts,
  toolErrors,
}: {
  parts: ToolUIPart[]
  toolErrors?: string[]
}) {
  return (
    <div data-slot="read-attachment-block" className="mb-2 flex flex-col">
      {parts.map((part) => (
        <AttachmentReadRow
          key={part.toolCallId}
          part={part}
          forceError={toolErrors?.includes(part.toolCallId)}
        />
      ))}
    </div>
  )
}

function AttachmentReadRow({
  part,
  forceError,
}: {
  part: ToolUIPart
  forceError?: boolean
}) {
  const input = part.input as ReadAttachmentInput | undefined
  const error = getToolErrorText(part) ?? (forceError ? 'Read failed' : '')
  const running = !error && getToolStatus(part) === 'running'
  const offset = input?.offset ?? 0
  const limit = Math.min(
    input?.limit ?? ATTACHMENT_READ_DEFAULT_BYTES,
    ATTACHMENT_READ_MAX_BYTES,
  )
  const end = offset + limit - 1

  return (
    <div
      data-tool-call-id={part.toolCallId}
      className="flex min-h-7 w-fit max-w-full flex-wrap items-center gap-x-2 px-2.5 text-xs"
    >
      <FileTextIcon className="text-muted-foreground size-3.5 shrink-0" />
      <span
        className={cn('text-foreground font-medium', running && 'text-shimmer')}
      >
        Read attachment
      </span>
      <span className="text-muted-foreground font-mono">
        bytes {offset}–{end}
      </span>
      {error && <span className="text-destructive">{error}</span>}
    </div>
  )
}

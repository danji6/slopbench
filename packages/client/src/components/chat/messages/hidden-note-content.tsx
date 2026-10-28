import { MarkdownRenderer } from '@/components/markdown/renderer'
import { useMathMode } from '@/hooks/chat/resolved-settings'
import { extractTextFromMessage, messageExtra } from '@/lib/chat/messages'
import type { MessageRecord } from '@/lib/chat/types'
import type { UIMessage } from 'ai'

type HiddenNoteContentProps = {
  message: UIMessage
  record?: MessageRecord
}

/** Displays stored note text, or details for commands that carry no parts. */
export function HiddenNoteContent({ message, record }: HiddenNoteContentProps) {
  const mathMode = useMathMode()
  const text = extractTextFromMessage(message)
  const command = messageExtra(record, 'command')

  if (command && !text.trim()) {
    return (
      <div className="space-y-2 wrap-anywhere whitespace-pre-wrap">
        <p>
          /{command.name}
          {command.argument ? ` ${command.argument}` : ''}
        </p>
        <p>Status: {command.status}</p>
        {command.error && <p>{command.error}</p>}
        {command.reason && <p>{command.reason}</p>}
      </div>
    )
  }

  if (!text.trim()) return <p className="text-muted-foreground">No content.</p>

  return (
    <MarkdownRenderer enableBreaks mathMode={mathMode}>
      {text}
    </MarkdownRenderer>
  )
}

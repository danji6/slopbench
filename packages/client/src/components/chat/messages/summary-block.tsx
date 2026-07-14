import { isMessageStreaming } from '@/lib/chat'
import type { UIMessage } from 'ai'
import { isTextUIPart } from 'ai'

import { CollapsibleBlock } from './collapsible-block'
import { useCollapsible } from './collapsible-store'
import { EditableText } from './editor/editable-text'
import { useMessageList } from './message-list/message-list-context'
import { SmoothText } from './smooth-text'

export function SummaryBlock({ message }: { message: UIMessage }) {
  const isStreaming = isMessageStreaming(message)
  const onIntoViewSettle = useMessageList()?.onIntoViewSettle
  const [open, onOpenChange] = useCollapsible(message.id)
  const textPart = message.parts.find(isTextUIPart)
  if (!textPart) return null

  const label = isStreaming ? 'Summarizing...' : 'Summary'

  return (
    <CollapsibleBlock
      data-slot="summary-block"
      label={label}
      shimmer={isStreaming}
      open={open}
      onOpenChange={onOpenChange}
      onExpand={onIntoViewSettle}
      fullWidth
      className="bg-muted/50 border-border border p-0.5"
      labelClassName="text-center w-full"
      floatingChevron
      footer={
        !isStreaming ? (
          <div className="text-muted-foreground/50 flex items-center gap-3 text-xs">
            <div className="h-px flex-1 bg-current opacity-30" />
            <span>Compacted</span>
            <div className="h-px flex-1 bg-current opacity-30" />
          </div>
        ) : undefined
      }
    >
      <div
        className="px-4 pt-2 pb-4"
        style={{
          fontFamily: 'var(--chat-font-family)',
          fontSize: 'var(--chat-font-size)',
        }}
      >
        <EditableText
          data-slot="summary-block"
          part={textPart}
          className="opacity-70"
        >
          <SmoothText part={textPart} />
        </EditableText>
      </div>
    </CollapsibleBlock>
  )
}

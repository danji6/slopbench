import { Surface } from '@/components/ui'
import { useSettings } from '@/hooks/chat'
import {
  extractTextFromMessage,
  isEditableMessage,
  isMessagePending,
} from '@/lib/chat'
import type { PartMetadata, UIMessageType } from '@/lib/chat'
import { cn } from '@/lib/utils'
import type { UIMessage } from 'ai'
import { memo, useMemo } from 'react'

import { ErrorBlock } from './error-block'
import { MessageContext } from './message-context'
import { MessageHeader, type MessageSender } from './message-header'
import { PartsRenderer } from './parts-renderer'
import { WaitingIndicator } from './waiting-indicator'

export type MessageViewProps = {
  message: UIMessage
  type?: UIMessageType
  sender?: MessageSender
  css?: string
  attachmentIds?: Record<string, string>
  partMeta?: PartMetadata
  error?: string
  isLast?: boolean
  className?: string
  noEdit?: boolean
}

type MessageContentProps = {
  message: UIMessage
  type?: UIMessageType
  attachmentIds?: Record<string, string>
  partMeta?: PartMetadata
  error?: string
}

// TODO simplify this component. ChatPrompts can't mutate.
/** Kind of deprecated, only used for ChatPrompts. */
export const MessageView = memo(function MessageView({
  message,
  sender,
  css,
  type,
  attachmentIds,
  partMeta,
  error,
  isLast,
  className,
  noEdit,
}: MessageViewProps) {
  const isUser = message.role === 'user'

  const canEdit = useMemo(
    () => !noEdit && isEditableMessage(message),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [message.parts.length, noEdit],
  )

  const content = useMemo(
    () => extractTextFromMessage(message),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [message.parts],
  )

  const messageCtx = useMemo(
    () => ({ id: message.id, canEdit, content }),
    [message.id, canEdit, content],
  )

  const cssSettings = useSettings()
  const globalCustomCss = cssSettings?.customCss ?? null
  const customCss = css ?? globalCustomCss ?? undefined

  const customCssClass = customCss
    ? `custom-css-${message.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
    : undefined

  const roleClass = isUser ? 'usr' : message.role === 'system' ? 'sys' : 'ai'

  const inner = (
    <div
      data-slot="message-view"
      className={cn(
        'flex w-full min-w-0 flex-col',
        isUser ? 'items-end' : 'items-start',
        !isLast && 'pb-4',
        roleClass,
        !customCssClass && className,
      )}
    >
      {!type && sender && <MessageHeader sender={sender} role={message.role} />}
      <MessageContent
        message={message}
        attachmentIds={attachmentIds}
        partMeta={partMeta}
        error={error}
        type={type}
      />
    </div>
  )

  return (
    <MessageContext.Provider value={messageCtx}>
      {customCssClass ? (
        <div className={cn(customCssClass, className)}>
          <style>{`
            @scope (.${customCssClass}) {
              ${customCss}
            }
          `}</style>
          {inner}
        </div>
      ) : (
        inner
      )}
    </MessageContext.Provider>
  )
})

const MessageContent = memo(function MessageContent({
  message,
  type,
  attachmentIds,
  partMeta,
  error,
}: MessageContentProps) {
  const isUser = message.role === 'user'
  const showPendingIndicator = isMessagePending(message) // TODO idle timer

  return (
    <Surface
      className={cn(
        'flex max-w-full flex-col gap-3 py-3 wrap-break-word',
        isUser ? 'w-fit' : 'w-full',
        message.role !== 'user' && 'border-0 bg-transparent',
      )}
    >
      <PartsRenderer
        message={message}
        type={type}
        attachmentIds={attachmentIds}
        partMeta={partMeta}
      />
      {error && <ErrorBlock messageId={message.id} error={error} />}
      {showPendingIndicator && (
        <WaitingIndicator visible className="static w-auto gap-2" />
      )}
    </Surface>
  )
})

import { useAgentPrompts } from '@/hooks/chat'
import { cn } from '@/lib/utils'
import { useDeferredValue } from 'react'

import { EmptyMessage } from './empty-message'
import { MessageView } from './messages'

export function ChatPrompts({
  showEmptyState,
  folderName,
  folderIcon,
  workDir,
  ...props
}: React.ComponentProps<'div'> & {
  folderName?: string
  folderIcon?: string
  showEmptyState?: boolean
  workDir?: string
}) {
  const { messages, sender, css } = useDeferredValue(useAgentPrompts(workDir))

  if (messages.length === 0) {
    if (!showEmptyState) return null
    return (
      <div {...props} className={cn('h-fit', props.className)}>
        <EmptyMessage folderName={folderName} folderIcon={folderIcon} />
      </div>
    )
  }

  return <ChatPromptMessages prompts={{ messages, sender, css }} {...props} />
}

type ChatPromptMessagesProps = React.ComponentProps<'div'> & {
  prompts: Pick<
    ReturnType<typeof useAgentPrompts>,
    'messages' | 'sender' | 'css'
  >
}

/** Renders already-resolved prompts without repeating preview evaluation. */
export function ChatPromptMessages({
  prompts,
  ...props
}: ChatPromptMessagesProps) {
  const { messages, sender, css } = prompts
  return (
    <div {...props} className={cn('h-fit', props.className)}>
      {messages.map((msg) => (
        <MessageView
          noEdit
          key={msg.id}
          message={msg}
          css={msg.role === 'assistant' ? css : undefined}
          sender={msg.role === 'assistant' ? sender : undefined}
        />
      ))}
    </div>
  )
}

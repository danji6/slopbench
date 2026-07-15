import { useAgentPrompts } from '@/hooks/chat'
import { cn } from '@/lib/utils'
import { useDeferredValue } from 'react'

import { EmptyMessage } from './empty-message'
import { MessageView } from './messages'

export function ChatPrompts({
  showEmptyState,
  workDir,
  ...props
}: React.ComponentProps<'div'> & { showEmptyState?: boolean; workDir?: string }) {
  const { messages, sender, css } = useDeferredValue(useAgentPrompts(workDir))

  if (messages.length === 0) {
    if (!showEmptyState) return null
    return (
      <div {...props} className={cn('h-fit', props.className)}>
        <EmptyMessage />
      </div>
    )
  }

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

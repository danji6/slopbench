import type { PendingMessage } from '@/lib/chat'
import { cn } from '@/lib/utils'
import { useState } from 'react'

import { ChatSession } from './chat-session'
import { useChatShellState } from './chat-shell-state'
import { ChatSidebars } from './chat-sidebars'
import type { ChatProps } from './chat-types'
import { EmptyChat } from './empty-chat'
import { AgentSettings } from './entities/agent/agent-settings'
import { ChatSearchProvider } from './search'

export type { ChatProps } from './chat-types'

export function Chat(props: ChatProps) {
  const [pendingMessage, setPendingMessage] = useState<PendingMessage | null>(
    null,
  )
  const { activeSessionId, activeAgentName, activeAgentDisplay, style } =
    useChatShellState(props.layoutConstraint)

  return (
    <ChatSearchProvider>
      <ChatSidebars
        data-slot="chat-area"
        className={cn('relative flex min-h-dvh flex-row', props.className)}
        style={style}
      >
        {activeSessionId ? (
          <ChatSession
            sessionId={activeSessionId}
            pendingMessage={pendingMessage}
            onPendingSent={() => setPendingMessage(null)}
            activeAgentName={activeAgentName}
            activeAgentDisplay={activeAgentDisplay}
            width={props.width}
            onError={props.onError}
          />
        ) : (
          <EmptyChat
            onFirstMessage={setPendingMessage}
            activeAgentName={activeAgentName}
            activeAgentDisplay={activeAgentDisplay}
            {...props}
          />
        )}
        <AgentSettings />
      </ChatSidebars>
    </ChatSearchProvider>
  )
}

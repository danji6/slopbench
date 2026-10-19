import { CodeAppearanceContext } from '@/components/markdown/code-appearance'
import { DialogErrorBoundary } from '@/components/ui'
import { useResolvedSettings } from '@/hooks/chat/resolved-settings'
import { useChatShellState } from '@/hooks/chat/shell-state'
import type { PendingMessage } from '@/lib/chat'
import { cn } from '@/lib/utils'
import { useMemo, useState } from 'react'

import { ChatSession } from './chat-session'
import { ChatSidebars } from './chat-sidebars'
import type { ChatProps } from './chat-types'
import { DraftRestoreDialog } from './draft-restore-dialog'
import { EmptyChat } from './empty-chat'
import { AgentSettings } from './entities/agent/agent-settings'
import { UserSettings } from './entities/user/user-settings'
import { ScriptManager } from './messages/editor/menu/script-manager'
import { ChatSearchProvider } from './search'

export type { ChatProps } from './chat-types'

export function Chat(props: ChatProps) {
  const [pendingMessage, setPendingMessage] = useState<PendingMessage | null>(null) // prettier-ignore
  const { activeSessionId, activeAgentName, activeAgentDisplay, style } =
    useChatShellState(props.layoutConstraint)
  const { codeBlockHighlighting, codeBlockLineNumbers } = useResolvedSettings()
  const codeAppearance = useMemo(
    () => ({
      highlighting: codeBlockHighlighting,
      lineNumbers: codeBlockLineNumbers,
    }),
    [codeBlockHighlighting, codeBlockLineNumbers],
  )

  return (
    <CodeAppearanceContext.Provider value={codeAppearance}>
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
          <UserSettings />
          <DialogErrorBoundary>
            <ScriptManager />
          </DialogErrorBoundary>
          <DialogErrorBoundary>
            <DraftRestoreDialog />
          </DialogErrorBoundary>
        </ChatSidebars>
      </ChatSearchProvider>
    </CodeAppearanceContext.Provider>
  )
}

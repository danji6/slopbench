import { useNavPadding } from '@/hooks'
import { useSettings, useWorkspaceFileIndexByRoot } from '@/hooks/chat'
import type { PendingMessage } from '@/lib/chat'
import type { SessionMode } from '@/lib/chat/modes'
import { nextSessionMode } from '@/lib/chat/modes'
import { api } from '@sb/convex/_generated/api'
import { useAction } from 'convex/react'
import { useCallback, useState } from 'react'
import { useLocation } from 'wouter'

import { ChatDock } from './chat-dock'
import { ChatLayout } from './chat-layout'
import { ChatPrompts } from './chat-prompts'
import { ChatScrollArea } from './chat-scroll-area'
import { ChatComposer } from './composer/chat-composer'
import { ComposerToolbar } from './composer/composer-toolbar'
import { ChatWorkspacePicker } from './sessions'
import type { AgentItem } from './sessions/agent-combobox'

type EmptyChatProps = React.ComponentProps<'div'> & {
  width?: string
  layoutConstraint?: 'dvw' | '%'
  onError?: (error: Error) => void
  onFirstMessage: (msg: PendingMessage) => void
  activeAgentName?: string
  activeAgentDisplay?: AgentItem
}

export function EmptyChat({
  onFirstMessage,
  activeAgentName,
  activeAgentDisplay,
  ...props
}: EmptyChatProps) {
  const { width = '800px' } = props
  const [, navigate] = useLocation()
  const createSession = useAction(api.actions.sessions.createWithWorkspace)
  const settings = useSettings()
  const topPadding = useNavPadding()
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
  const fileIndex = useWorkspaceFileIndexByRoot(workspaceRoot)

  // Manual mode tracking since no session is available here
  const [mode, setMode] = useState<SessionMode>('normal')
  const handleWorkspaceChange = useCallback((root: string | null) => {
    setWorkspaceRoot(root)
    if (!root) setMode('normal')
  }, [])
  const cycleMode = useCallback(() => {
    setMode((current) => nextSessionMode(current))
  }, [])

  const handleSubmit = useCallback(
    async (message: PendingMessage) => {
      const { sessionId } = await createSession({
        activeAgentId: settings?.recentAgentId ?? undefined,
        workspaceRoot: workspaceRoot ?? undefined,
        mode: mode === 'normal' ? undefined : mode,
      })
      onFirstMessage(message)
      navigate(`/?id=${sessionId}`, { replace: true })
    },
    [
      createSession,
      workspaceRoot,
      mode,
      onFirstMessage,
      navigate,
      settings?.recentAgentId,
    ],
  )

  const handleRunCommand = useCallback(
    async (name: string, argument: string, silent: boolean) => {
      if (name !== 'system' && name !== 'assistant') return
      if (!argument) return

      await handleSubmit({
        content: argument,
        files: [],
        role: name,
        ...(silent && { silent: true }),
      })
    },
    [handleSubmit],
  )

  const chatBoxWidth = `min(95%, ${width} - var(--spacing)*36)`

  return (
    <ChatLayout
      mainContent={(bottomPadding) => (
        <ChatScrollArea className="mx-auto w-full flex-1">
          <div
            className="mx-auto flex min-h-full w-full shrink-0 flex-col pt-6"
            style={{
              width: chatBoxWidth,
              maxWidth: '100%',
              paddingTop: topPadding,
              paddingBottom: bottomPadding + 64,
            }}
          >
            <ChatPrompts
              showEmptyState
              className="mx-auto my-auto w-full"
              style={{ width: `calc(${chatBoxWidth} - var(--spacing)*6)` }}
            />
          </div>
        </ChatScrollArea>
      )}
      dock={
        <ChatDock width={chatBoxWidth}>
          <div className="mb-1.5 flex items-center px-1">
            <ChatWorkspacePicker
              value={workspaceRoot}
              onChange={handleWorkspaceChange}
            />
          </div>
          <ChatComposer
            onSubmit={handleSubmit}
            onRunCommand={handleRunCommand}
            onCycleMode={workspaceRoot ? cycleMode : undefined}
            status="ready"
            hideTokenWidget
            commandAvailability={{
              hasActiveSession: false,
              hasActiveAgent: Boolean(settings?.recentAgentId),
            }}
            activeAgentName={activeAgentName}
            startContent={
              <ComposerToolbar
                fallbackAgent={activeAgentDisplay}
                mode={{
                  value: mode,
                  workspaceAvailable: Boolean(workspaceRoot),
                  cycle: cycleMode,
                }}
              />
            }
            fileIndex={fileIndex}
            className="w-full"
          />
        </ChatDock>
      }
    />
  )
}

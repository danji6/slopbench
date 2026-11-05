import { ErrorFallback } from '@/components/ui'
import { useKeyboardInset } from '@/hooks'
import {
  useIsAdmin,
  useSettings,
  useUserProfile,
  useWorkspaceFileIndexByFolder,
} from '@/hooks/chat'
import { useOwnedAgent, useSelectAgent } from '@/hooks/chat/agent'
import { useModelProviders } from '@/hooks/chat/connections'
import { NO_SESSION_DRAFT_KEY, type PendingMessage } from '@/lib/chat'
import type { SessionMode } from '@/lib/chat/modes'
import { toastError } from '@/lib/notifications'
import { setSelectedSessionFolder } from '@/lib/ui-settings'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { ApprovalMode } from '@sb/convex/types'
import { selectedBuiltinTools } from '@sb/core/tool-capabilities'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { useAction } from 'convex/react'
import { useCallback, useRef, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { useLocation, useSearch } from 'wouter'

import { ChatDock } from './chat-dock'
import { ChatLayout } from './chat-layout'
import { ChatScrollArea } from './chat-scroll-area'
import { ChatComposer } from './composer/chat-composer'
import type { ComposerHandle } from './composer/chat-composer'
import { ComposerToolbar } from './composer/composer-toolbar'
import type { AgentItem } from './sessions/agent-combobox'
import { FolderPicker } from './sessions/folder-picker'
import { EmptyChatWelcome } from './welcome/empty-chat-welcome'

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
  const search = useSearch()
  const folderId = new URLSearchParams(search).get('folder') as Id<'sessionFolders'> | null // prettier-ignore
  const folder = useQuery(api.sessionFolders.get, folderId ? { folderId } : 'skip') // prettier-ignore
  const workspaceRoot = folder?.workspace?.path ?? null
  const [orphanDraftKey, setOrphanDraftKey] = useState<string | null>(null)
  const draftKey = orphanDraftKey ?? (folderId ? `folder:${folderId}` : NO_SESSION_DRAFT_KEY) // prettier-ignore
  const createSession = useAction(api.actions.sessions.createWithWorkspace)
  const settings = useSettings()
  const providers = useModelProviders()
  const agent = useOwnedAgent(settings?.recentAgentId)
  const selectAgent = useSelectAgent()
  const composerRef = useRef<ComposerHandle>(null)
  const [switching, setSwitching] = useState(false)

  const [composerState, setComposerState] = useState({
    key: draftKey,
    hasContent: false,
    ready: false,
  })

  const handleContentChange = useCallback(
    (hasContent: boolean, ready: boolean) => {
      setComposerState({ key: draftKey, hasContent, ready })
    },
    [draftKey],
  )

  const userId = useUserProfile()?._id
  const isAdmin = useIsAdmin()
  const keyboardInset = useKeyboardInset()
  const fileIndex = useWorkspaceFileIndexByFolder(folder ?? undefined)

  const canReadProject = Boolean(
    workspaceRoot &&
    isAdmin &&
    selectedBuiltinTools(agent?.tools).includes('read_file'),
  )

  async function clearAgent() {
    if (switching) return
    setSwitching(true)
    try {
      await selectAgent(null)
    } catch (error) {
      toastError(error, 'Could not change agent')
    } finally {
      setSwitching(false)
    }
  }

  // Manual mode tracking since no session is available here
  const [mode, setMode] = useState<SessionMode>('normal')
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('ask')
  const handleWorkspaceChange = useCallback(
    (id: string | null) => {
      if (userId) setSelectedSessionFolder(userId, id)
      setOrphanDraftKey(folderId && folder === null ? draftKey : null)
      navigate(id ? `/?folder=${id}` : '/', { replace: true })
      if (!id) {
        setMode('normal')
        setApprovalMode('ask')
      }
    },
    [navigate, folderId, folder, draftKey, userId],
  )

  const handleSubmit = useCallback(
    async (message: PendingMessage) => {
      if (folderId && !folder)
        throw new Error('Choose an available folder before sending')
      const { sessionId } = await createSession({
        activeAgentId: settings?.recentAgentId ?? undefined,
        folderId: folderId ?? undefined,
        mode: mode === 'normal' ? undefined : mode,
        approvalMode: approvalMode === 'ask' ? undefined : approvalMode,
      })
      onFirstMessage(message)
      navigate(`/?id=${sessionId}`, { replace: true })
    },
    [
      createSession,
      folderId,
      folder,
      mode,
      approvalMode,
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
      bottomInset={keyboardInset}
      mainContent={(bottomPadding) => (
        <ChatScrollArea className="mx-auto w-full flex-1">
          <div
            className="mx-auto flex min-h-full w-full shrink-0 flex-col pt-18 lg:pt-2"
            style={{
              width: chatBoxWidth,
              maxWidth: '100%',
              paddingBottom: bottomPadding + 64,
            }}
          >
            <div className="mx-auto my-auto w-full py-8 has-data-[slot=welcome-agent-grid]:my-0">
              <ErrorBoundary
                fallbackRender={ErrorFallback}
                resetKeys={[settings?.recentAgentId, providers?.length]}
              >
                <EmptyChatWelcome
                  providersLoaded={providers !== undefined}
                  hasProviders={Boolean(providers?.length)}
                  settingsLoaded={settings !== undefined}
                  agent={agent}
                  folderLoaded={!folderId || folder !== undefined}
                  folderName={folder?.name}
                  folderIcon={folder?.icon}
                  workDir={workspaceRoot ?? undefined}
                  canReadProject={canReadProject}
                  startersDisabled={
                    composerState.key !== draftKey ||
                    !composerState.ready ||
                    composerState.hasContent
                  }
                  composerRef={composerRef}
                  switchingAgent={switching}
                  onChooseAgent={() => void clearAgent()}
                />
              </ErrorBoundary>
            </div>
          </div>
        </ChatScrollArea>
      )}
      dock={
        <ChatDock width={chatBoxWidth}>
          <div className="pointer-events-auto mb-1.5 flex flex-wrap items-center justify-between gap-2 px-1">
            <FolderPicker
              value={folderId}
              onChange={handleWorkspaceChange}
              showPath={false}
            />
          </div>
          <ChatComposer
            onSubmit={handleSubmit}
            onRunCommand={handleRunCommand}
            status="ready"
            key={draftKey}
            draftKey={draftKey}
            inputRef={composerRef}
            onContentChange={handleContentChange}
            shellAvailable={isAdmin && Boolean(workspaceRoot)}
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
                  set: setMode,
                }}
                approval={{
                  value: approvalMode,
                  available: isAdmin && Boolean(workspaceRoot),
                  toggle: () =>
                    setApprovalMode((current) =>
                      current === 'ask' ? 'unrestricted' : 'ask',
                    ),
                }}
              />
            }
            mode={{
              value: mode,
              workspaceAvailable: Boolean(workspaceRoot),
              set: setMode,
            }}
            fileIndex={fileIndex}
            className="w-full"
          />
        </ChatDock>
      }
    />
  )
}

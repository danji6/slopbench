import { RippleButton } from '@/components/ui'
import { useAgentPrompts } from '@/hooks/chat/agent'
import type { ComposerHandle } from '@/hooks/chat/composer-editor'
import { useView } from '@/hooks/view'
import { resolveWelcomeView } from '@/lib/chat/empty-chat'
import type { Doc } from '@cv/convex/_generated/dataModel'
import { PlugZapIcon } from 'lucide-react'
import type { RefObject } from 'react'

import { ChatPromptMessages } from '../chat-prompts'
import { FolderIconView } from '../sessions/folder-picker'
import { SessionAvatar } from '../sessions/session-avatar'
import { WelcomeAgentGrid } from './agent-grid'
import { StarterCards } from './starter-cards'
import { WelcomeTransition } from './welcome-transition'

type EmptyChatWelcomeProps = {
  providersLoaded: boolean
  hasProviders: boolean
  settingsLoaded: boolean
  agent: Doc<'agents'> | null | undefined
  folderLoaded: boolean
  folderName?: string
  folderIcon?: string
  workDir?: string
  canReadProject: boolean
  startersDisabled: boolean
  composerRef: RefObject<ComposerHandle | null>
  switchingAgent: boolean
  onChooseAgent: () => void
  onPlanChange: () => void
}

export function EmptyChatWelcome(props: EmptyChatWelcomeProps) {
  const prompts = useAgentPrompts(props.workDir)
  const view = resolveWelcomeView({
    providersLoaded: props.providersLoaded,
    hasProviders: props.hasProviders,
    selectionLoaded: props.settingsLoaded && props.agent !== undefined,
    hasAgent: Boolean(props.agent),
    promptsLoaded: !prompts.isLoading,
    hasPrompts: prompts.messages.length > 0,
    folderLoaded: props.folderLoaded,
  })
  const agentView = view === 'prompts' || view === 'starters'
  const viewKey = agentView
    ? `${view}:${props.agent?._id}:${props.workDir}:${props.folderName}:${props.canReadProject}`
    : view

  return (
    <WelcomeTransition viewKey={view === 'loading' ? null : viewKey}>
      {view !== 'loading' && (
        <>
          {agentView && (
            <div className="mb-6 flex justify-end">
              <RippleButton
                variant="input"
                className="text-muted-foreground"
                disabled={props.switchingAgent}
                onClick={props.onChooseAgent}
              >
                Choose another agent
              </RippleButton>
            </div>
          )}
          <WelcomeContent {...props} view={view} prompts={prompts} />
        </>
      )}
    </WelcomeTransition>
  )
}

type WelcomeContentProps = EmptyChatWelcomeProps & {
  view: Exclude<ReturnType<typeof resolveWelcomeView>, 'loading'>
  prompts: ReturnType<typeof useAgentPrompts>
}

function WelcomeContent({ view, prompts, ...props }: WelcomeContentProps) {
  const settings = useView('settings')

  if (view === 'providers') {
    return (
      <section
        className="mx-auto max-w-md space-y-4 text-center"
        aria-label="Model provider setup"
      >
        <PlugZapIcon className="text-primary mx-auto size-8" />
        <h1 className="text-2xl font-medium text-balance">
          Connect a model provider
        </h1>
        <p className="text-muted-foreground text-sm">
          Add a provider and its models to start chatting with your agents.
        </p>
        <RippleButton onClick={() => settings.open('models')}>
          Open models settings
        </RippleButton>
      </section>
    )
  }
  if (view === 'agents') return <WelcomeAgentGrid />
  if (view === 'prompts') return <ChatPromptMessages prompts={prompts} />

  return (
    <section className="w-full" aria-label="Welcome">
      <header className="space-y-3 text-center">
        {props.folderName ? (
          <div className="text-muted-foreground flex min-w-0 items-center justify-center gap-2 text-sm leading-5">
            <span
              aria-hidden="true"
              className="flex size-4 shrink-0 -translate-y-px items-center justify-center"
            >
              <FolderIconView icon={props.folderIcon} />
            </span>
            <span className="min-w-0 wrap-anywhere">{props.folderName}</span>
          </div>
        ) : (
          <SessionAvatar
            avatarId={props.agent?.avatarId}
            noHover
            size="md"
            className="mx-auto"
          />
        )}
        <h1 className="text-2xl font-medium text-balance">
          {props.canReadProject
            ? 'What would you like to work on?'
            : 'What’s on your mind?'}
        </h1>
        <p className="text-muted-foreground text-sm wrap-anywhere">
          A few ways to get started with {props.agent?.name}.
        </p>
      </header>
      <StarterCards
        project={props.canReadProject}
        disabled={props.startersDisabled}
        composerRef={props.composerRef}
        onPlanChange={props.onPlanChange}
      />
    </section>
  )
}

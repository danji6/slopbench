import { ChatSessionView } from '@/components/chat/chat-session-view'
import { ChatSearchProvider } from '@/components/chat/search/chat-search-context'
import { Toaster } from '@/components/ui/sonner'
import '@/globals.css'
import { useAbortStream } from '@/hooks/chat/message-actions'
import { ChatMessagesProvider } from '@/hooks/chat/messages'
import { useSendMessage } from '@/hooks/chat/send'
import { useActiveSessionId } from '@/hooks/chat/session'
import { StreamStoreProvider, useChatStatus } from '@/hooks/chat/stream'
import { useWorkspaceFileIndex } from '@/hooks/chat/workspace'
import { ConvexQueryCacheProvider } from 'convex-helpers/react/cache'
import { ConvexProvider } from 'convex/react'
import { useEffect, useSyncExternalStore } from 'react'
import { useLocation } from 'wouter'

import {
  approvalFixtureClient,
  approvalFixtureControls,
} from './subagent-approvals-client'

function View() {
  return (
    <ChatSessionView
      dockWidth="min(95%, 800px)"
      topPadding={80}
      status={useChatStatus()}
      error={null}
      onSubmit={useSendMessage()}
      onStop={useAbortStream()}
      onRunCommand={async () => {}}
      onContinueAgent={() => {}}
      hasActiveAgent={false}
      activeAgentName="Explore"
      onDismissError={() => {}}
      fileIndex={useWorkspaceFileIndex(undefined, false)}
    />
  )
}

function Controls() {
  const [, navigate] = useLocation()
  const mutations = useSyncExternalStore(
    approvalFixtureControls.subscribe,
    approvalFixtureControls.getSnapshot,
  )
  useEffect(() => {
    window.addEventListener(
      'release-approvals',
      approvalFixtureControls.release,
    )
    return () =>
      window.removeEventListener(
        'release-approvals',
        approvalFixtureControls.release,
      )
  }, [])
  return (
    <div className="bg-background fixed top-0 z-30 flex gap-3 p-2">
      <button
        onClick={() => navigate('/?fixture=subagent-approvals&id=parent')}
      >
        View parent
      </button>
      <button onClick={() => navigate('/?fixture=subagent-approvals&id=child')}>
        View child
      </button>
      <button onClick={approvalFixtureControls.resolve}>
        Resolve approval
      </button>
      <button onClick={approvalFixtureControls.failNext}>
        Fail next approval
      </button>
      <button onClick={approvalFixtureControls.stopTyping}>Stop typing</button>
      <output data-testid="approval-mutations" className="sr-only">
        {mutations}
      </output>
    </div>
  )
}

function Session() {
  const sessionId = useActiveSessionId()
  return (
    <>
      <Controls />
      <ChatMessagesProvider key={sessionId}>
        <StreamStoreProvider>
          <ChatSearchProvider>
            <View />
          </ChatSearchProvider>
        </StreamStoreProvider>
      </ChatMessagesProvider>
    </>
  )
}

/** Exercises the production chat view, picker, and optimistic updates together. */
export function SubagentApprovalsFixture() {
  return (
    <ConvexProvider client={approvalFixtureClient}>
      <ConvexQueryCacheProvider>
        <Session />
        <Toaster />
      </ConvexQueryCacheProvider>
    </ConvexProvider>
  )
}

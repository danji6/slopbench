import { ChatSessionView } from '@/components/chat/chat-session-view'
import { ChatSearchProvider } from '@/components/chat/search/chat-search-context'
import '@/globals.css'
import { useAbortStream } from '@/hooks/chat/message-actions'
import { ChatMessagesProvider } from '@/hooks/chat/messages'
import { useActiveSessionId } from '@/hooks/chat/session'
import { StreamStoreProvider, useChatStatus } from '@/hooks/chat/stream'
import { useWorkspaceFileIndex } from '@/hooks/chat/workspace'
import { ConvexQueryCacheProvider } from 'convex-helpers/react/cache'
import { ConvexProvider } from 'convex/react'
import { useSyncExternalStore } from 'react'
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
      onSubmit={() => {}}
      onStop={useAbortStream()}
      onRunCommand={async () => {}}
      onContinueAgent={() => {}}
      hasActiveAgent={false}
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
      </ConvexQueryCacheProvider>
    </ConvexProvider>
  )
}

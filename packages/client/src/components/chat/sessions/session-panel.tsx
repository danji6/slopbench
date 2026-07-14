import { Sidebar } from '@/components/ui'
import { useActiveSession, useIsSessionOwner } from '@/hooks/chat'

import { SessionAgentList } from './session-agent-list'
import { SessionConfig } from './session-config'
import { SessionMemberList } from './session-member-list'
import { SessionPlanSection } from './session-plan-section'

export function SessionPanel() {
  const session = useActiveSession()
  const isOwner = useIsSessionOwner()

  if (!session) {
    return (
      <p className="text-muted-foreground mt-4 px-4 text-center text-sm">
        Open a session to manage it.
      </p>
    )
  }

  return (
    <>
      <Sidebar.Section label="Agents">
        <SessionAgentList />
      </Sidebar.Section>
      <Sidebar.Section label="Members">
        <SessionMemberList />
      </Sidebar.Section>
      <SessionPlanSection />
      {isOwner && <SessionConfig />}
    </>
  )
}

import { Combobox } from '@/components/ui'
import {
  useActiveSession,
  useIsSessionOwner,
  useLinkedAgents,
  useOwnedAgents,
} from '@/hooks/chat'
import {
  useActivateAgent,
  useLinkAgent,
  useUnlinkAgent,
} from '@/hooks/chat/participants'
import type { Id } from '@sb/convex/_generated/dataModel'
import { PlusIcon } from 'lucide-react'

import { AgentCombobox, type AgentItem } from './agent-combobox'
import { ParticipantList } from './participant-list'
import { SessionAgentItem } from './session-agent-item'

export function SessionAgentList() {
  const session = useActiveSession()
  const linked = useLinkedAgents()
  const owned = useOwnedAgents() ?? []
  const isOwner = useIsSessionOwner()
  const activate = useActivateAgent()
  const unlink = useUnlinkAgent()
  const link = useLinkAgent()

  const ownedIds = new Set(owned.map((agent) => agent._id))
  const linkedIds = new Set(linked.map((agent) => agent._id))
  const unlinked = owned
    .filter((agent) => !linkedIds.has(agent._id))
    .map((agent) => ({
      id: agent._id,
      name: agent.name,
      avatarId: agent.avatarId,
    }))

  return (
    <ParticipantList
      items={linked}
      getKey={(agent) => agent._id}
      getSearchText={(agent) => agent.name}
      emptyLabel="No agents linked yet."
      renderItem={(agent) => (
        <SessionAgentItem
          agent={agent}
          isActive={session?.activeAgentId === agent._id}
          canUnlink={isOwner || ownedIds.has(agent._id)}
          onActivate={() => void activate(agent._id)}
          onUnlink={() => void unlink(agent._id)}
        />
      )}
      footer={
        <LinkAgentMenu agents={unlinked} onLink={(id) => void link(id)} />
      }
    />
  )
}

function LinkAgentMenu({
  agents,
  onLink,
}: {
  agents: AgentItem[]
  onLink: (id: Id<'agents'>) => void
}) {
  if (agents.length === 0) return null
  return (
    <AgentCombobox
      agents={agents}
      onValueChange={(id) => id && onLink(id as Id<'agents'>)}
      trigger={
        <Combobox.Trigger
          size="sm"
          variant="input"
          className="text-muted-foreground mt-1 w-fit"
          aria-label="Link agent"
        >
          <span className="flex items-center gap-2.5">
            <PlusIcon />
            Link agent
          </span>
        </Combobox.Trigger>
      }
    />
  )
}

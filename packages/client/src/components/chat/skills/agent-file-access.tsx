import { useIsAdmin } from '@/hooks/chat/tools'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { ReactNode } from 'react'

type AgentFileAccessProps = {
  agentId?: Id<'agents'>
  className?: string
  children: (agentId: Id<'agents'>) => ReactNode
}

/** Shows filesystem controls only for a saved agent and an administrator. */
export function AgentFileAccess({
  agentId,
  className,
  children,
}: AgentFileAccessProps) {
  const admin = useIsAdmin()
  if (!admin) {
    return (
      <p className="text-muted-foreground p-4 text-sm">
        Personal files and skills are available to administrators.
      </p>
    )
  }
  if (!agentId) {
    return (
      <p className="text-muted-foreground p-4 text-sm">
        Save this agent before configuring its personal folder and skills.
      </p>
    )
  }
  return (
    <div key={agentId} className={className}>
      {children(agentId)}
    </div>
  )
}

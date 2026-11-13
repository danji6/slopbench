import type { Id } from '@cv/convex/_generated/dataModel'

import { AgentFileAccess } from './agent-file-access'
import { AgentHomeSettings } from './agent-home'

export function AgentFiles({ agentId }: { agentId?: Id<'agents'> }) {
  return (
    <AgentFileAccess agentId={agentId}>
      {(id) => <AgentHomeSettings agentId={id} />}
    </AgentFileAccess>
  )
}

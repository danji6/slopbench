import type { Id } from '@sb/convex/_generated/dataModel'

import { AgentFileAccess } from './agent-file-access'
import { SkillLibrary } from './skill-library'

export function AgentSkills({ agentId }: { agentId?: Id<'agents'> }) {
  return (
    <AgentFileAccess
      agentId={agentId}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      {(id) => <SkillLibrary agentId={id} />}
    </AgentFileAccess>
  )
}

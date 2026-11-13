import { AlertMessage } from '@/components/ui'
import type { Id } from '@cv/convex/_generated/dataModel'

import { AgentFileAccess } from './agent-file-access'
import { SkillLibrary } from './skill-library'

export function AgentSkills({
  agentId,
  skillAccessEnabled,
}: {
  agentId?: Id<'agents'>
  skillAccessEnabled: boolean
}) {
  return (
    <AgentFileAccess
      agentId={agentId}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      {(id) => (
        <>
          {!skillAccessEnabled && (
            <AlertMessage
              className="mx-4 mt-4 shrink-0"
              variant="warning"
              dismissible={false}
            >
              Skill access is currently off for this agent. Enable Skills in the
              Tools tab.
            </AlertMessage>
          )}
          <SkillLibrary agentId={id} />
        </>
      )}
    </AgentFileAccess>
  )
}

import { Button, ContextMenu } from '@/components/ui'
import {
  openAgentEditor,
  useActiveSession,
  useLinkedAgents,
  useSelectAgent,
} from '@/hooks/chat'
import {
  useActivateAgent,
  useContinueAgent,
  useUnlinkAgent,
} from '@/hooks/chat/participants'
import { cn } from '@/lib/utils'
import { PencilIcon, ReplyIcon, Unlink2Icon } from 'lucide-react'

import { SessionAvatar } from './session-avatar'

export function AgentsStrip({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  const session = useActiveSession()
  const linked = useLinkedAgents()
  const activate = useActivateAgent()
  const continueAgent = useContinueAgent()
  const unlink = useUnlinkAgent()
  const selectAgent = useSelectAgent()

  return (
    <div className={cn('flex flex-col gap-4', className)} {...props}>
      {linked.map((agent) => (
        <ContextMenu key={agent._id}>
          <ContextMenu.Trigger>
            <Button
              variant="plain"
              size="icon"
              aria-label={`${
                session?.activeAgentId === agent._id ? 'Deactivate' : 'Activate'
              } ${agent.name}`}
              onClick={() => void activate(agent._id)}
            >
              <SessionAvatar
                avatarId={agent.avatarId}
                className={cn(
                  'size-11 border-2 border-transparent opacity-60 hover:opacity-100 focus-visible:opacity-80',
                  session?.activeAgentId === agent._id &&
                    'border-ring/80 opacity-100 focus-visible:opacity-100',
                )}
              />
            </Button>
          </ContextMenu.Trigger>
          <ContextMenu.Content>
            <ContextMenu.Item onSelect={() => void continueAgent(agent._id)}>
              <ReplyIcon />
              Continue
            </ContextMenu.Item>
            <ContextMenu.Item
              onSelect={() => {
                selectAgent(agent._id)
                openAgentEditor()
              }}
            >
              <PencilIcon />
              Edit
            </ContextMenu.Item>
            <ContextMenu.Item onSelect={() => void unlink(agent._id)}>
              <Unlink2Icon />
              Unlink
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu>
      ))}
    </div>
  )
}

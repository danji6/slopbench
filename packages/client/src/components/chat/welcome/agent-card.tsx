import { RippleButton, Tooltip } from '@/components/ui'
import type { AgentSummary } from '@/hooks/chat/agent'
import { useLayoutEffect, useRef, useState } from 'react'

import { SessionAvatar } from '../sessions/session-avatar'

type WelcomeAgentCardProps = {
  agent: AgentSummary
  disabled: boolean
  onChoose: (id: string) => void
}

/** Keeps card text within its height and exposes clipped descriptions. */
export function WelcomeAgentCard({
  agent,
  disabled,
  onChoose,
}: WelcomeAgentCardProps) {
  const description = agent.description?.trim() || 'No description provided.'
  const text = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(false)

  useLayoutEffect(() => {
    const element = text.current
    if (!element) return
    const measure = () => {
      setOverflow(element.scrollHeight > element.clientHeight + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [description])

  return (
    <Tooltip
      disabled={!overflow || disabled}
      longPress={overflow && !disabled}
      longPressCloseDelay={10_000}
    >
      <Tooltip.Trigger
        delay={200}
        render={
          <RippleButton
            variant="input"
            disabled={disabled}
            onClick={() => onChoose(agent._id)}
            className="h-24 w-full min-w-0 items-start justify-start gap-3 rounded-2xl p-4 text-left whitespace-normal"
          >
            <SessionAvatar avatarId={agent.avatarId} noHover size="md" />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate leading-5 font-medium">
                {agent.name}
              </span>
              <span
                ref={text}
                className="text-muted-foreground line-clamp-2 text-sm leading-4.5 font-normal wrap-anywhere"
              >
                {description}
              </span>
            </span>
          </RippleButton>
        }
      />
      <Tooltip.Content
        role="tooltip"
        className="max-h-[min(24rem,60dvh)] w-80 max-w-[calc(100dvw-2rem)] overflow-y-auto text-sm wrap-anywhere whitespace-pre-wrap"
      >
        {description}
      </Tooltip.Content>
    </Tooltip>
  )
}

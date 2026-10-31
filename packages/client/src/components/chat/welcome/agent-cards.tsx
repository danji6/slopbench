import type { AgentSummary } from '@/hooks/chat/agent'
import { motion, useReducedMotion } from 'motion/react'

import { WelcomeAgentCard } from './agent-card'

type WelcomeAgentCardsProps = {
  agents: AgentSummary[]
  disabled: boolean
  onChoose: (id: string) => void
}

/** Fades equally sized cards into place as agents arrive. */
export function WelcomeAgentCards({
  agents,
  disabled,
  onChoose,
}: WelcomeAgentCardsProps) {
  const reducedMotion = useReducedMotion()

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3 p-1">
      {agents.map((agent, index) => {
        const delay = reducedMotion ? 0 : Math.min(index * 0.025, 0.15)
        return (
          <motion.div
            key={agent._id}
            className="min-w-0"
            initial={{ opacity: 0, y: reducedMotion ? 0 : -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              type: 'spring',
              stiffness: 350,
              damping: 26,
              delay,
              opacity: {
                duration: reducedMotion ? 0 : 0.2,
                delay,
              },
              y: reducedMotion ? { duration: 0 } : undefined,
            }}
          >
            <WelcomeAgentCard
              agent={agent}
              disabled={disabled}
              onChoose={onChoose}
            />
          </motion.div>
        )
      })}
    </div>
  )
}

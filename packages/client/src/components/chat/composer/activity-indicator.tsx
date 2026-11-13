import { cn } from '@/lib/utils'
import { toDisplayName } from '@cv/core/utils/names'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

/** Character budget for two names before switching to a people count. */
const MAX_LENGTH = 20

type AgentActivity = {
  name: string
  state: 'working' | 'waiting'
}

type ActivityIndicatorProps = {
  names: string[]
  agent?: AgentActivity
  className?: string
}

function typingLabel(names: string[]): string | null {
  if (!names.length) return null
  if (names.length === 1) return `${names[0]} is typing`
  const joined = names.join(' and ')
  return names.length > 2 || joined.length > MAX_LENGTH
    ? `${names.length} people are typing`
    : `${joined} are typing`
}

export function ActivityIndicator({
  names,
  agent,
  className,
}: ActivityIndicatorProps) {
  const reducedMotion = useReducedMotion()
  const displayNames = names.map((name) => toDisplayName(name))
  const people = typingLabel(displayNames)
  const agentLabel = agent
    ? `${toDisplayName(agent.name, 'Agent')} is ${agent.state}`
    : null
  const label = [people, agentLabel].filter(Boolean).join(' · ')
  const title = [
    displayNames.length
      ? `${displayNames.join(', ')} ${displayNames.length === 1 ? 'is' : 'are'} typing`
      : null,
    agentLabel,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <AnimatePresence initial={false}>
      {label && (
        <motion.div
          data-slot="activity-indicator"
          role="status"
          aria-label={title}
          title={title}
          initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
          transition={{ duration: reducedMotion ? 0 : 0.2 }}
          className={cn(
            'text-muted-foreground pointer-events-auto flex h-4 min-w-0 flex-1 items-center gap-2 text-xs whitespace-nowrap',
            className,
          )}
        >
          {people && (
            <span aria-hidden className="motion-safe:text-shimmer truncate">
              {people}
            </span>
          )}
          {people && agentLabel && <span aria-hidden>·</span>}
          {agentLabel && (
            <span
              aria-hidden
              className={cn(
                'truncate',
                people && 'max-w-3/5 shrink-0',
                agent?.state === 'working' && 'motion-safe:text-shimmer',
              )}
            >
              {agentLabel}
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

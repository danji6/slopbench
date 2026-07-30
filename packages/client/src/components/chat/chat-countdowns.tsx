import {
  useSendCooldownUntil,
  useStreamFireAt,
  useStreamRawStatus,
} from '@/hooks/chat'
import { useCountdown } from '@/hooks/countdown'
import { useDelayedFlag } from '@/hooks/debounce'
import { cn } from '@/lib/utils'
import { TimerIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'

import { WaitingIndicator } from './messages/waiting-indicator'

const COUNTDOWN_SPRING = {
  type: 'spring',
  stiffness: 500,
  damping: 40,
} as const

function seconds(ms: number): number {
  return Math.floor(ms / 1000)
}

export function SlowModeLabel({ className }: { className?: string }) {
  const until = useSendCooldownUntil()
  return (
    <SlowModeCountdown key={until ?? 0} until={until} className={className} />
  )
}

function SlowModeCountdown({
  until,
  className,
}: {
  until: number | null
  className?: string
}) {
  const remaining = useCountdown(until)

  return (
    <AnimatePresence>
      {remaining > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={COUNTDOWN_SPRING}
          className={cn(
            'text-muted-foreground flex items-center gap-1 px-2 text-xs whitespace-nowrap',
            className,
          )}
        >
          <TimerIcon className="size-3.5 shrink-0" />
          <span>Slow mode • {seconds(remaining)}s</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function PendingAgentRow() {
  const status = useStreamRawStatus()
  const fireAt = useStreamFireAt()
  const remaining = useCountdown(status === 'pending' ? fireAt : null)
  const pending = status === 'pending'
  const counting = pending && !!fireAt && remaining > 0
  const waiting = useDelayedFlag(pending && !counting, 500)

  return (
    <AnimatePresence initial={false}>
      {pending && (counting || waiting) && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={COUNTDOWN_SPRING}
          className="overflow-hidden"
        >
          <div className="text-muted-foreground flex items-center gap-2 pt-10 text-sm">
            {counting ? (
              <>
                <TimerIcon className="size-4 shrink-0" />
                <span className="flex-1">
                  Agent responds in {seconds(remaining)}s…
                </span>
              </>
            ) : (
              <WaitingIndicator visible className="static w-auto gap-2" />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

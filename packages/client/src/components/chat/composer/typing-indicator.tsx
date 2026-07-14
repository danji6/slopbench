import { PulsingDots } from '@/components/ui'
import { cn } from '@/lib/utils'
import { FALLBACK_DISPLAY_NAME } from '@sb/core/const'
import { AnimatePresence, motion } from 'motion/react'

/** Character budget for user names before collapsing into "N more". */
const MAX_LENGTH = 20

/** Max user names to show before collapsing. */
const MAX_USERS = 3

/** Only show fallback name once for all anonymous users. */
function dedupeAnonymous(names: string[]): string[] {
  let seenAnon = false
  const out: string[] = []
  for (const name of names) {
    if (name === FALLBACK_DISPLAY_NAME) {
      if (seenAnon) continue
      seenAnon = true
    }
    out.push(name)
  }
  return out
}

function truncateNames(text: string): string {
  if (text.length <= MAX_LENGTH) return text
  return text.slice(0, MAX_LENGTH - 1).replace(/[,\s]+$/, '') + '…'
}

function buildLabel(rawNames: string[]): string | null {
  const names = dedupeAnonymous(rawNames)
  const total = names.length
  if (total === 0) return null

  // Show at most 3 names and collapse the rest
  const maxShown = total > MAX_USERS ? MAX_USERS : total
  const shown: string[] = []
  let len = 0
  for (const name of names) {
    if (shown.length >= maxShown) break
    const addition = shown.length === 0 ? name.length : name.length + 2 // ", "
    if (shown.length >= 1 && len + addition > MAX_LENGTH) break
    shown.push(name)
    len += addition
  }

  const remaining = total - shown.length
  const joined =
    remaining === 0 && shown.length > 1
      ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
      : shown.join(', ')

  let label = truncateNames(joined)
  if (remaining > 0) {
    label += ` and ${remaining} more ${remaining === 1 ? 'user' : 'users'}`
  }

  return `${label} ${total === 1 ? 'is' : 'are'} typing…`
}

export function TypingIndicator({
  names,
  className,
}: {
  names: string[]
  className?: string
}) {
  const label = buildLabel(names)

  return (
    <AnimatePresence>
      {label && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ type: 'spring', stiffness: 500, damping: 40 }}
          className={cn(
            'text-muted-foreground bg-background/80 supports-backdrop-filter:bg-background/60 flex items-center gap-2 rounded-full px-3 py-2 text-xs shadow-sm backdrop-blur-md',
            className,
          )}
        >
          <PulsingDots className="gap-0.5" dotClassName="size-1" />
          <span className="truncate">{label}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

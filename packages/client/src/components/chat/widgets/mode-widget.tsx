import { RippleButton } from '@/components/ui'
import { QuickTooltip } from '@/components/ui/quick-tooltip'
import { Result } from '@/lib'
import type { SessionMode } from '@/lib/chat/modes'
import { getSessionModeDefinition } from '@/lib/chat/modes'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import { MessageCircleIcon, NotebookPenIcon } from 'lucide-react'

const MODE_ICONS: Record<SessionMode, LucideIcon> = {
  normal: MessageCircleIcon,
  plan: NotebookPenIcon,
}

type ModeWidgetProps = {
  className?: string
  mode: SessionMode
  onCycle: () => void | Promise<void>
}

/**
 * Composer control cycling the session mode (normal, plan, ask (todo)).
 * The mode/cycle source is injected by the caller.
 */
export function ModeWidget({ className, mode, onCycle }: ModeWidgetProps) {
  const def = getSessionModeDefinition(mode)
  const Icon = MODE_ICONS[def.id]
  const active = def.id !== 'normal'

  return (
    <QuickTooltip
      text={`${def.label} mode. ${def.description} (Shift+Tab to switch)`}
    >
      <RippleButton
        onClick={() => Result.from(onCycle).catch()}
        variant="stealth"
        size="icon"
        className={cn(
          'text-muted-foreground size-10',
          active && 'text-m3-primary w-auto gap-1.5 px-3',
          className,
        )}
        aria-label={`Session mode: ${def.label}`}
      >
        <Icon />
        {active && def.label}
      </RippleButton>
    </QuickTooltip>
  )
}

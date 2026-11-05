import { QuickTooltip } from '@/components/ui/quick-tooltip'
import { RippleButton } from '@/components/ui/ripple-button'
import { Result } from '@/lib/result'
import { cn } from '@/lib/utils'
import type { ApprovalMode } from '@sb/convex/types'
import {
  LightbulbIcon,
  LockKeyholeIcon,
  LockKeyholeOpenIcon,
} from 'lucide-react'

type ModeWidgetProps = {
  onDisable: () => void | Promise<void>
}

export function ModeWidget({ onDisable }: ModeWidgetProps) {
  return (
    <QuickTooltip text="Plan mode is active">
      <RippleButton
        onClick={() => void Result.from(onDisable).catch()}
        variant="stealth"
        size="icon"
        className="text-m3-primary size-10"
        aria-label="Disable plan mode"
      >
        <LightbulbIcon />
      </RippleButton>
    </QuickTooltip>
  )
}

type ApprovalModeWidgetProps = {
  mode: ApprovalMode
  onToggle: () => void | Promise<void>
}

export function ApprovalModeWidget({
  mode,
  onToggle,
}: ApprovalModeWidgetProps) {
  const unrestricted = mode === 'unrestricted'
  const label = unrestricted
    ? 'Unrestricted access is active. Click to require approvals.'
    : 'Ask for approval. Click to allow unrestricted access.'
  const Icon = unrestricted ? LockKeyholeOpenIcon : LockKeyholeIcon

  return (
    <QuickTooltip text={label} className="max-w-dvw">
      <RippleButton
        onClick={() => void Result.from(onToggle).catch()}
        variant="stealth"
        size="icon"
        className={cn(
          'text-muted-foreground size-10',
          unrestricted && 'text-orange-500 dark:text-orange-400',
        )}
        aria-label={label}
        aria-pressed={unrestricted}
      >
        <Icon />
      </RippleButton>
    </QuickTooltip>
  )
}

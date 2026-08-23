import { ConfirmDialog, RippleButton } from '@/components/ui'
import { QuickTooltip } from '@/components/ui/quick-tooltip'
import { Result } from '@/lib'
import type { SessionMode } from '@/lib/chat/modes'
import { cn } from '@/lib/utils'
import type { ApprovalMode } from '@sb/convex/types'
import {
  LightbulbIcon,
  LockKeyholeIcon,
  LockKeyholeOpenIcon,
} from 'lucide-react'

type ModeWidgetProps = {
  mode: SessionMode
  onDisable: () => void | Promise<void>
}

/** Active plan mode indicator with confirmation. */
export function ModeWidget({ mode, onDisable }: ModeWidgetProps) {
  if (mode !== 'plan') return null

  return (
    <ConfirmDialog
      title="Disable plan mode?"
      description="The agent will leave its read-only planning state."
      confirmText="Disable"
      onConfirm={() => void Result.from(onDisable).catch()}
    >
      <RippleButton
        variant="stealth"
        size="icon"
        className="text-m3-primary size-10"
        aria-label="Disable plan mode"
        title="Plan mode is active"
      >
        <LightbulbIcon />
      </RippleButton>
    </ConfirmDialog>
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
    <QuickTooltip text={label}>
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

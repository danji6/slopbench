import { cn } from '@/lib/utils'
import { ArrowLeftRightIcon } from 'lucide-react'

import { Dialog } from './dialog'
import { QuickTooltip } from './quick-tooltip'
import { RippleButton } from './ripple-button'
import { Separator } from './separator'

type SettingsDialogTitleProps = React.ComponentProps<typeof Dialog.Title> & {
  section?: string
  action?: React.ReactNode
}

export function SettingsDialogTitle({
  children,
  section,
  action,
  className,
  ...props
}: SettingsDialogTitleProps) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Dialog.Title
        className={cn('flex min-w-0 items-baseline gap-3', className)}
        {...props}
      >
        <span className="shrink-0">{children}</span>
        {section && (
          <>
            {' '}
            <Separator
              orientation="vertical"
              aria-hidden
              className="self-center data-[orientation=vertical]:h-5"
            />
            <span className="text-muted-foreground min-w-0 truncate font-normal">
              {section}
            </span>
          </>
        )}
      </Dialog.Title>
      {action}
    </div>
  )
}

type SettingsSwitchButtonProps = {
  target: 'agent' | 'user'
  onClick: () => void
  disabled?: boolean
}

export function SettingsSwitchButton({
  target,
  onClick,
  disabled,
}: SettingsSwitchButtonProps) {
  const label = `Switch to ${target} settings`

  return (
    <QuickTooltip text={label}>
      <RippleButton
        type="button"
        variant="stealth"
        size="icon-sm"
        className="text-muted-foreground shrink-0"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
      >
        <ArrowLeftRightIcon />
      </RippleButton>
    </QuickTooltip>
  )
}

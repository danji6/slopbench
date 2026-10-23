import { cn } from '@/lib/utils'
import { RotateCcwIcon } from 'lucide-react'
import { type ReactNode, useId } from 'react'

import { HelpButton } from './help'
import { Input, type InputProps } from './input'
import { Label } from './label'
import { Switch, type SwitchProps } from './switch'

type SettingsFieldProps = {
  label: string
  help?: ReactNode
  htmlFor?: string
  children: ReactNode
  action?: ReactNode
  /** Keeps controls aligned with rows that have reset buttons. */
  reserveActionSpace?: boolean
  className?: string
}

/** Aligns labels, controls and an optional action in consistent columns. */
export function SettingsField({
  label,
  help,
  htmlFor,
  children,
  action,
  reserveActionSpace = true,
  className,
}: SettingsFieldProps) {
  const showAction = reserveActionSpace || Boolean(action)
  return (
    <div
      data-slot="settings-field"
      className={cn('flex min-h-8 items-center gap-2 px-1', className)}
    >
      <div className="text-muted-foreground flex min-w-0 flex-1 items-center gap-1.5">
        <Label htmlFor={htmlFor} className="text-sm leading-normal font-normal">
          {label}
        </Label>
        {help && (
          <HelpButton triggerLabel={`About ${label}`} title={label}>
            {help}
          </HelpButton>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1">
        {children}
        {showAction && (
          <div className="flex size-8 shrink-0 items-center justify-center">
            {action}
          </div>
        )}
      </div>
    </div>
  )
}

type SettingsInputProps = Omit<InputProps, 'children'> &
  Pick<SettingsFieldProps, 'label' | 'help' | 'reserveActionSpace'> & {
    onReset?: () => void
    resetDisabled?: boolean
    resetTitle?: string
  }

/** Renders a compact, labeled input with an optional adjacent reset action. */
export function SettingsInput({
  label,
  help,
  reserveActionSpace,
  id: providedId,
  className,
  disabled,
  onReset,
  resetDisabled,
  resetTitle = 'Reset to default',
  ...props
}: SettingsInputProps) {
  const generatedId = useId()
  const id = providedId ?? generatedId

  return (
    <SettingsField
      label={label}
      help={help}
      htmlFor={id}
      reserveActionSpace={reserveActionSpace}
      action={
        onReset && (
          <button
            type="button"
            aria-label={`Reset ${props['aria-label'] ?? label} to default`}
            title={resetTitle}
            disabled={disabled || resetDisabled}
            className="text-muted-foreground hover:text-foreground flex size-8 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50"
            onClick={onReset}
          >
            <RotateCcwIcon className="size-3.5" />
          </button>
        )
      }
    >
      <Input
        {...props}
        id={id}
        disabled={disabled}
        className={cn('h-8 w-32 px-3 text-xs', className)}
      />
    </SettingsField>
  )
}

type SettingsSwitchProps = Omit<SwitchProps, 'children'> &
  Pick<SettingsFieldProps, 'label' | 'help' | 'reserveActionSpace'>

/** Aligns a settings switch with inputs while keeping help beside its label. */
export function SettingsSwitch({
  label,
  help,
  reserveActionSpace,
  id: providedId,
  ...props
}: SettingsSwitchProps) {
  const generatedId = useId()
  const id = providedId ?? generatedId

  return (
    <SettingsField
      label={label}
      help={help}
      htmlFor={id}
      reserveActionSpace={reserveActionSpace}
    >
      <Switch size="sm" {...props} id={id} />
    </SettingsField>
  )
}

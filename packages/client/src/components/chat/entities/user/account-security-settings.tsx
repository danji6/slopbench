import { AlertMessage } from '@/components/ui/alert-message'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingButton } from '@/components/ui/loading-button'
import { SettingsCollapsible } from '@/components/ui/settings-collapsible'
import { SettingsList } from '@/components/ui/settings-list'
import type { AccountSecurity, PasswordFields } from '@/hooks/account-security'
import { validateNewPassword } from '@/lib/auth/password'
import { LogOutIcon } from 'lucide-react'

type AccountSecurityProps = { security: AccountSecurity }

export function AccountSecuritySettings({ security }: AccountSecurityProps) {
  const { form, formId, busy, retrySeconds } = security

  return (
    <SettingsList className="pb-4">
      <SettingsList.Item unclickable unhoverable>
        <SettingsCollapsible
          label="Change password"
          disabled={busy}
          contentClassName="pt-2 pb-4"
        >
          <div className="flex w-full max-w-80 flex-col gap-4">
            <PasswordField
              security={security}
              name="oldPassword"
              label="Old password"
            />
            <PasswordField
              security={security}
              name="newPassword"
              label="New password"
            />
            <PasswordField
              security={security}
              name="repeatNewPassword"
              label="Repeat new password"
            />
            {form.formState.errors.root?.message && (
              <AlertMessage role="alert" dismissible={false}>
                {form.formState.errors.root.message}
              </AlertMessage>
            )}
            {retrySeconds > 0 && (
              <p role="status" className="text-muted-foreground text-sm">
                Try again in {retrySeconds} seconds.
              </p>
            )}
            <LoadingButton
              type="submit"
              form={formId}
              variant="primary"
              loading={security.changingPassword}
              disabled={busy || retrySeconds > 0}
              className="self-start"
            >
              Change password
            </LoadingButton>
          </div>
        </SettingsCollapsible>
      </SettingsList.Item>
      <SettingsList.Item unclickable unhoverable>
        {security.logoutError && (
          <AlertMessage role="alert" dismissible={false}>
            {security.logoutError}
          </AlertMessage>
        )}
        <LoadingButton
          type="button"
          variant="input"
          loading={security.loggingOut}
          disabled={busy}
          onClick={security.requestLogout}
          className="self-start"
        >
          <LogOutIcon /> Logout
        </LoadingButton>
      </SettingsList.Item>
    </SettingsList>
  )
}

type PasswordFieldProps = AccountSecurityProps & {
  name: keyof PasswordFields
  label: string
}

function PasswordField({ security, name, label }: PasswordFieldProps) {
  const { form, formId, busy } = security
  const id = `${formId}-${name}`
  const error = form.formState.errors[name]

  function validate(value: string) {
    if (name === 'newPassword') return validateNewPassword(value)
    if (name !== 'repeatNewPassword') return true
    return (
      value === form.getValues('newPassword') || 'New passwords do not match.'
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} variant="settings">
        {label}
      </Label>
      <Input
        {...form.register(name, {
          required: `${label} is required.`,
          validate,
        })}
        id={id}
        form={formId}
        type="password"
        autoComplete={
          name === 'oldPassword' ? 'current-password' : 'new-password'
        }
        required
        disabled={busy}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        variant="outline"
        className="h-10 text-sm"
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-destructive text-sm">
          {error.message}
        </p>
      )}
    </div>
  )
}

/** Owns the password inputs without nesting a form inside settings. */
export function AccountSecurityForm({ security }: AccountSecurityProps) {
  return <form id={security.formId} onSubmit={security.submit} noValidate />
}

export function AccountLogoutConfirmation({ security }: AccountSecurityProps) {
  return (
    <ConfirmDialog
      open={security.confirmLogout}
      onOpenChange={security.setConfirmLogout}
      variant="destructive"
      title="Discard changes and log out?"
      description="Your unsaved settings and password entries will be lost."
      confirmText="Discard and log out"
      cancelText="Keep editing"
      onConfirm={() => void security.logout()}
    />
  )
}

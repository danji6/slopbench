import { useCountdown } from '@/hooks/countdown'
import { retryAfterSeconds } from '@/lib/auth/retry-after'
import { extractErrorMessage } from '@/lib/errors'
import { useEffect, useId, useRef, useState } from 'react'
import type { BaseSyntheticEvent } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

export type PasswordFields = {
  oldPassword: string
  newPassword: string
  repeatNewPassword: string
}

type AccountSecurityOptions = {
  active: boolean
  settingsBusy: boolean
  hasUnsavedSettings: boolean
  onLoggedOut: () => void
}

const EMPTY_PASSWORDS: PasswordFields = {
  oldPassword: '',
  newPassword: '',
  repeatNewPassword: '',
}

/** Handles account credentials independently of persisted settings drafts. */
export function useAccountSecurity({
  active,
  settingsBusy,
  hasUnsavedSettings,
  onLoggedOut,
}: AccountSecurityOptions) {
  const formId = useId()
  const form = useForm<PasswordFields>({ defaultValues: EMPTY_PASSWORDS })
  const { reset } = form
  const [operation, setOperation] = useState<'password' | 'logout' | null>(null)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const [lockedUntil, setLockedUntil] = useState<number | null>(null)
  const inFlight = useRef(false)
  const remaining = useCountdown(lockedUntil)
  const busy = settingsBusy || operation !== null
  const passwordDirty = form.formState.isDirty

  useEffect(() => {
    if (!active) return
    return () => {
      reset(EMPTY_PASSWORDS)
      setConfirmLogout(false)
      setLogoutError(null)
    }
  }, [active, reset])

  function lockForRetryWindow({ response }: { response: Response }) {
    const seconds = retryAfterSeconds(response)
    if (seconds) setLockedUntil(Date.now() + seconds * 1000)
  }

  async function updatePassword(values: PasswordFields) {
    if (!active || busy || inFlight.current) return
    if (remaining > 0) return
    inFlight.current = true
    setOperation('password')
    form.clearErrors()
    try {
      const { changePassword } = await import('@/lib/auth/client')
      const result = await changePassword({
        currentPassword: values.oldPassword,
        newPassword: values.newPassword,
        revokeOtherSessions: true,
        fetchOptions: { onError: lockForRetryWindow },
      })
      if (result.error) {
        showPasswordError(result.error)
        return
      }
      reset(EMPTY_PASSWORDS)
      toast.success('Password changed. Other sessions have been signed out.')
    } catch (error) {
      form.setError('root', {
        message: extractErrorMessage(error, 'Could not change password.'),
      })
    } finally {
      inFlight.current = false
      setOperation(null)
    }
  }

  function showPasswordError(error: { code?: string; message?: string }) {
    if (error.code === 'INVALID_PASSWORD') {
      form.setError('oldPassword', { message: 'Old password is incorrect.' })
      form.setFocus('oldPassword')
      return
    }
    form.setError('root', {
      message: error.message ?? 'Could not change password.',
    })
  }

  async function logout() {
    if (!active || busy || inFlight.current) return
    inFlight.current = true
    setOperation('logout')
    setConfirmLogout(false)
    setLogoutError(null)
    try {
      const { signOut } = await import('@/lib/auth/client')
      const result = await signOut()
      if (result.error) {
        setLogoutError(result.error.message ?? 'Could not log out.')
        return
      }
      reset(EMPTY_PASSWORDS)
      onLoggedOut()
    } catch (error) {
      setLogoutError(extractErrorMessage(error, 'Could not log out.'))
    } finally {
      inFlight.current = false
      setOperation(null)
    }
  }

  function requestLogout() {
    if (!active || busy || inFlight.current) return
    if (hasUnsavedSettings || passwordDirty) {
      setConfirmLogout(true)
      return
    }
    void logout()
  }

  async function submit(event?: BaseSyntheticEvent) {
    await form.handleSubmit(updatePassword)(event)
  }

  return {
    form,
    formId,
    submit,
    busy,
    pending: operation !== null,
    changingPassword: operation === 'password',
    loggingOut: operation === 'logout',
    retrySeconds: Math.ceil(remaining / 1000),
    logoutError,
    requestLogout,
    logout,
    confirmLogout: active && confirmLogout,
    setConfirmLogout,
  }
}

export type AccountSecurity = ReturnType<typeof useAccountSecurity>

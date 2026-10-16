/// <reference types="bun-types" />
import type * as SecurityComponents from '@/components/chat/entities/user/account-security-settings'
import type * as SecurityHook from '@/hooks/account-security'
import type * as AuthClient from '@/lib/auth/client'
import {
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'
import { MotionConfig } from 'motion/react'
import { act, useEffect } from 'react'
import { type Root, createRoot } from 'react-dom/client'

import { setupDom } from '../setup/dom'

setupDom()

let components: typeof SecurityComponents
let hooks: typeof SecurityHook
let auth: typeof AuthClient
let security: SecurityHook.AccountSecurity
let root: Root | null = null
let active = true
let settingsBusy = false
let dirtySettings = false
let changePassword: ReturnType<
  typeof spyOn<typeof AuthClient, 'changePassword'>
>
let signOut: ReturnType<typeof spyOn<typeof AuthClient, 'signOut'>>
const onLoggedOut = mock(() => {})
const saveSettings = mock(() => {})

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  window.location.href = 'http://localhost:4178'
  components =
    await import('@/components/chat/entities/user/account-security-settings')
  hooks = await import('@/hooks/account-security')
  auth = await import('@/lib/auth/client')
})

beforeEach(() => {
  active = true
  settingsBusy = false
  dirtySettings = false
  onLoggedOut.mockClear()
  saveSettings.mockClear()
  changePassword = spyOn(auth, 'changePassword').mockResolvedValue({
    error: null,
  } as never)
  signOut = spyOn(auth, 'signOut').mockResolvedValue({ error: null } as never)
  localStorage.clear()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  changePassword.mockRestore()
  signOut.mockRestore()
  document.body.innerHTML = ''
})

function Harness() {
  const currentSecurity = hooks.useAccountSecurity({
    active,
    settingsBusy,
    hasUnsavedSettings: dirtySettings,
    onLoggedOut,
  })
  useEffect(() => {
    security = currentSecurity
  })
  return (
    <>
      <form
        id="settings-form"
        onSubmit={(event) => {
          event.preventDefault()
          saveSettings()
        }}
      >
        <input name="displayName" defaultValue="Edited name" />
        {active && (
          <components.AccountSecuritySettings security={currentSecurity} />
        )}
        <button type="submit">Apply</button>
      </form>
      <components.AccountSecurityForm security={currentSecurity} />
      <components.AccountLogoutConfirmation security={currentSecurity} />
    </>
  )
}

async function mount() {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await rerender()
}

async function rerender() {
  await act(async () =>
    root?.render(
      <MotionConfig skipAnimations>
        <Harness />
      </MotionConfig>,
    ),
  )
}

function fill(values: Partial<SecurityHook.PasswordFields> = {}) {
  act(() => {
    security.form.setValue('oldPassword', 'old-password', { shouldDirty: true })
    security.form.setValue('newPassword', 'new-password', { shouldDirty: true })
    security.form.setValue('repeatNewPassword', 'new-password', {
      shouldDirty: true,
    })
    for (const [name, value] of Object.entries(values)) {
      security.form.setValue(name as keyof SecurityHook.PasswordFields, value, {
        shouldDirty: true,
      })
    }
  })
}

async function submit() {
  await act(async () => {
    await security.submit()
  })
}

test('password inputs have their own form, labels, masking and autocomplete', async () => {
  await mount()
  const inputs = [
    ...document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  ]
  expect(inputs).toHaveLength(3)
  expect(inputs.map((input) => input.autocomplete)).toEqual([
    'current-password',
    'new-password',
    'new-password',
  ])
  for (const input of inputs) {
    expect(input.getAttribute('form')).toBe(security.formId)
    expect(document.querySelector(`label[for="${input.id}"]`)).not.toBeNull()
  }
  expect(document.querySelector('form form')).toBeNull()
})

test.each([
  { oldPassword: '' },
  { newPassword: '' },
  { repeatNewPassword: '' },
  { repeatNewPassword: 'mismatch' },
  { newPassword: '1234567', repeatNewPassword: '1234567' },
  { newPassword: 'x'.repeat(129), repeatNewPassword: 'x'.repeat(129) },
])('rejects invalid password fields: %j', async (values) => {
  await mount()
  fill(values)
  await submit()
  expect(changePassword).not.toHaveBeenCalled()
  expect(document.querySelector('[role="alert"]')).not.toBeNull()
})

test.each([8, 128])(
  'accepts the %s-character password boundary',
  async (length) => {
    await mount()
    fill({
      newPassword: 'x'.repeat(length),
      repeatNewPassword: 'x'.repeat(length),
    })
    await submit()
    expect(changePassword).toHaveBeenCalledTimes(1)
  },
)

test('submits only credentials, revokes other sessions and clears fields on success', async () => {
  await mount()
  fill({
    newPassword: '  new-password  ',
    repeatNewPassword: '  new-password  ',
  })
  await submit()
  expect(changePassword).toHaveBeenCalledWith(
    expect.objectContaining({
      currentPassword: 'old-password',
      newPassword: '  new-password  ',
      revokeOtherSessions: true,
    }),
  )
  expect(saveSettings).not.toHaveBeenCalled()
  expect(onLoggedOut).not.toHaveBeenCalled()
  expect(security.form.getValues()).toEqual({
    oldPassword: '',
    newPassword: '',
    repeatNewPassword: '',
  })
  expect(localStorage.length).toBe(0)
})

test('Apply does not validate or submit passwords', async () => {
  await mount()
  fill({ newPassword: '', repeatNewPassword: 'mismatch' })
  await act(async () => {
    document
      .querySelector('#settings-form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  expect(saveSettings).toHaveBeenCalledTimes(1)
  expect(changePassword).not.toHaveBeenCalled()
})

test('incorrect old password is reported without clearing entries', async () => {
  changePassword.mockResolvedValue({
    error: { code: 'INVALID_PASSWORD', message: 'Invalid password' },
  } as never)
  await mount()
  fill()
  await submit()
  expect(document.body.textContent).toContain('Old password is incorrect.')
  expect(security.form.getValues('newPassword')).toBe('new-password')
})

test('network failures remain retryable', async () => {
  changePassword.mockRejectedValue(new Error('Network unavailable'))
  await mount()
  fill()
  await submit()
  expect(document.body.textContent).toContain('Network unavailable')
  expect(security.pending).toBe(false)
  changePassword.mockResolvedValue({ error: null } as never)
  await submit()
  expect(changePassword).toHaveBeenCalledTimes(2)
})

test('obeys the server retry window', async () => {
  changePassword.mockImplementation(async (options) => {
    const onError = options?.fetchOptions?.onError
    if (typeof onError === 'function') {
      await onError({
        response: new Response(null, {
          status: 429,
          headers: { 'X-Retry-After': '3' },
        }),
      } as never)
    }
    return { error: { message: 'Too many requests.' } } as never
  })
  await mount()
  fill()
  await submit()
  expect(security.retrySeconds).toBeGreaterThan(0)
  await submit()
  expect(changePassword).toHaveBeenCalledTimes(1)
})

test('prevents overlapping account requests', async () => {
  let resolve!: (value: never) => void
  changePassword.mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  await mount()
  fill()
  let pending!: Promise<void>
  await act(async () => {
    pending = security.submit()
  })
  expect(security.changingPassword).toBe(true)
  await act(async () => {
    await security.submit()
    await security.logout()
  })
  expect(changePassword).toHaveBeenCalledTimes(1)
  expect(signOut).not.toHaveBeenCalled()
  await act(async () => {
    resolve({ error: null } as never)
    await pending
  })
})

test('blocks account operations during a settings save', async () => {
  settingsBusy = true
  await mount()
  fill()
  await submit()
  await act(async () => {
    security.requestLogout()
  })
  expect(changePassword).not.toHaveBeenCalled()
  expect(signOut).not.toHaveBeenCalled()
})

test('clears passwords when leaving Account or closing settings', async () => {
  await mount()
  fill()
  active = false
  await rerender()
  active = true
  await rerender()
  expect(security.form.getValues()).toEqual({
    oldPassword: '',
    newPassword: '',
    repeatNewPassword: '',
  })
})

test('clears an abandoned logout confirmation when settings close', async () => {
  await mount()
  fill()
  act(() => security.requestLogout())
  expect(security.confirmLogout).toBe(true)
  active = false
  await rerender()
  active = true
  await rerender()
  expect(security.confirmLogout).toBe(false)
  expect(signOut).not.toHaveBeenCalled()
})

test('clean logout needs no confirmation and completes cleanup', async () => {
  await mount()
  await act(async () => {
    security.requestLogout()
  })
  expect(signOut).toHaveBeenCalledTimes(1)
  expect(onLoggedOut).toHaveBeenCalledTimes(1)
  expect(security.confirmLogout).toBe(false)
})

test.each(['settings', 'password'])(
  'confirms logout with unsaved %s edits and supports cancellation',
  async (kind) => {
    dirtySettings = kind === 'settings'
    await mount()
    if (kind === 'password') fill()
    act(() => security.requestLogout())
    expect(security.confirmLogout).toBe(true)
    expect(signOut).not.toHaveBeenCalled()
    act(() => security.setConfirmLogout(false))
    expect(onLoggedOut).not.toHaveBeenCalled()
    await act(async () => {
      await security.logout()
    })
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(onLoggedOut).toHaveBeenCalledTimes(1)
  },
)

test('failed logout preserves edits and skips cleanup', async () => {
  signOut.mockResolvedValue({
    error: { message: 'Logout unavailable' },
  } as never)
  await mount()
  fill()
  await act(async () => {
    await security.logout()
  })
  expect(onLoggedOut).not.toHaveBeenCalled()
  expect(security.form.getValues('oldPassword')).toBe('old-password')
  expect(document.body.textContent).toContain('Logout unavailable')
})

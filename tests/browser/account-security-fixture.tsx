import {
  AccountLogoutConfirmation,
  AccountSecurityForm,
  AccountSecuritySettings,
} from '@/components/chat/entities/user/account-security-settings'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RippleButton } from '@/components/ui/ripple-button'
import { SettingsFooter } from '@/components/ui/settings-footer'
import { SettingsTabs } from '@/components/ui/settings-tabs'
import '@/globals.css'
import { useAccountSecurity } from '@/hooks/account-security'
import { useFormDraft } from '@/hooks/chat/form-draft'
import { useSettingsSave } from '@/hooks/chat/settings-save'
import { USER_SETTINGS_DRAFT_KEY } from '@/lib/chat/editor-draft-store'
import { UserIcon, WrenchIcon } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'

/** Exercises account actions inside the same form and dialog structure as settings. */
export function AccountSecurityFixture() {
  const [open, setOpen] = useState(true)
  const [tab, setTab] = useState('user')
  const [loggedOut, setLoggedOut] = useState(false)
  const [saved, setSaved] = useState(0)
  const form = useForm({ defaultValues: { displayName: 'Fixture user' } })
  const draft = useFormDraft(USER_SETTINGS_DRAFT_KEY, form, 'your settings')
  const { saving, apply, save } = useSettingsSave(
    form,
    async (values) => {
      setSaved((count) => count + 1)
      form.reset(values)
      draft.clear()
    },
    () => setOpen(false),
  )
  const security = useAccountSecurity({
    active: open && tab === 'user',
    settingsBusy: saving,
    hasUnsavedSettings: form.formState.isDirty,
    onLoggedOut: () => {
      form.reset()
      draft.clear()
      setLoggedOut(true)
    },
  })

  if (loggedOut) return <h1>Sign in</h1>

  return (
    <main className="bg-background text-foreground min-h-screen p-4">
      <output aria-label="Settings saves">{saved}</output>
      <Dialog open={open} onOpenChange={setOpen}>
        <Dialog.Trigger render={<RippleButton>Settings</RippleButton>} />
        <Dialog.Content
          showCloseButton={false}
          className="flex h-[min(95svh,800px)] flex-col p-0 sm:max-w-2xl"
        >
          <form onSubmit={apply} className="flex min-h-0 flex-1 flex-col">
            <Dialog.Header className="px-6 py-4">
              <Dialog.Title>Settings</Dialog.Title>
            </Dialog.Header>
            <SettingsTabs
              value={tab}
              onValueChange={setTab}
              className="min-h-0 flex-1"
            >
              <SettingsTabs.List>
                <SettingsTabs.Trigger value="user" icon={<UserIcon />}>
                  Account
                </SettingsTabs.Trigger>
                <SettingsTabs.Trigger value="tools" icon={<WrenchIcon />}>
                  Tools
                </SettingsTabs.Trigger>
              </SettingsTabs.List>
              <SettingsTabs.Content value="user" title="Account">
                <div className="flex items-center gap-4 px-4 py-3">
                  <div
                    aria-label="Avatar"
                    className="bg-primary/20 size-14 shrink-0 rounded-full"
                  />
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="fixture-name" variant="settings">
                      Name
                    </Label>
                    <Input
                      id="fixture-name"
                      {...form.register('displayName')}
                    />
                  </div>
                </div>
                <AccountSecuritySettings security={security} />
              </SettingsTabs.Content>
              <SettingsTabs.Content value="tools" title="Tools">
                Tool settings
              </SettingsTabs.Content>
            </SettingsTabs>
            <SettingsFooter
              isDirty={form.formState.isDirty}
              busy={saving || security.pending}
              onClose={() => setOpen(false)}
              onDiscard={() => {
                form.reset()
                draft.clear()
                setOpen(false)
              }}
              onSave={save}
            />
          </form>
          <AccountSecurityForm security={security} />
        </Dialog.Content>
      </Dialog>
      <AccountLogoutConfirmation security={security} />
    </main>
  )
}

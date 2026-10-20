import { SkillLibrary } from '@/components/chat/skills/skill-library'
import {
  AlertMessage,
  ConfirmDialog,
  Dialog,
  ErrorBoundary,
  type FallbackProps,
  LoadingOverlay,
  RippleButton,
  type RippleButtonProps,
  SettingsDialogTitle,
  SettingsFooter,
  SettingsList,
  SettingsSwitchButton,
  SettingsTabs,
} from '@/components/ui'
import { getFontFamily } from '@/fonts'
import { useAccountSecurity } from '@/hooks/account-security'
import {
  useMcpServers,
  useModelProviders,
  usePromptItems,
  useReminderItems,
  useSettings,
} from '@/hooks/chat'
import { useOpenAgentEditor } from '@/hooks/chat/agent-editor'
import { useFormDraft } from '@/hooks/chat/form-draft'
import { useSettingsSave } from '@/hooks/chat/settings-save'
import { useUserSettingsPersistence } from '@/hooks/chat/user-settings-persistence'
import { useScopedTheme } from '@/hooks/theme'
import { useView, useViewCloseGuard } from '@/hooks/view'
import { USER_SETTINGS_DRAFT_KEY } from '@/lib/chat/editor-draft-store'
import { extractErrorMessage } from '@/lib/errors'
import { getSettingsOverride } from '@/lib/settings-override'
import { cn } from '@/lib/utils'
import { ThemeScope } from '@/providers/theme-scope'
import { api } from '@sb/convex/_generated/api'
import { useQuery } from 'convex/react'
import {
  ActivityIcon,
  BlocksIcon,
  BotIcon,
  PaletteIcon,
  SettingsIcon,
  UserIcon,
  WrenchIcon,
} from 'lucide-react'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'

import { ShellSettings } from '../shell-settings'
import {
  AccountLogoutConfirmation,
  AccountSecurityForm,
  AccountSecuritySettings,
} from './account-security-settings'
import { AppearanceSettings } from './appearance-settings'
import { BehaviorSettings } from './behavior-settings'
import { McpSettings } from './mcp-settings'
import { ModelSettings } from './model-settings'
import { ProfileSettings } from './profile-settings'
import type { SettingsFormValues } from './settings-schema'
import {
  defaultSettingsValues,
  loadedSettingsValues,
  withoutSecrets,
} from './user-settings-values'
import { WebSearchSettings } from './web-search-settings'

/** `?view=` segment owned by user settings; its value is the active tab. */
const USER_SETTINGS_VIEW = 'settings'
const USER_SETTINGS_DEFAULT_TAB = 'user'
const USER_SETTINGS_TABS = [
  { value: 'user', label: 'Account', icon: UserIcon },
  { value: 'behavior', label: 'Behavior', icon: ActivityIcon },
  { value: 'models', label: 'Models', icon: BotIcon },
  { value: 'skills', label: 'Skills', icon: BlocksIcon },
  { value: 'tools', label: 'Tools', icon: WrenchIcon },
  { value: 'appearance', label: 'Appearance', icon: PaletteIcon },
]

export type ChatSettingsProps = RippleButtonProps & {
  collapsed?: boolean
}

export function ChatSettingsButton({
  collapsed = false,
  onClick,
  ...props
}: ChatSettingsProps) {
  const view = useView(USER_SETTINGS_VIEW)

  return (
    <RippleButton
      {...props}
      variant="stealth"
      size={!collapsed ? 'default' : 'icon'}
      aria-label="Settings"
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) view.open(USER_SETTINGS_DEFAULT_TAB)
      }}
      className={cn(
        'text-muted-foreground rounded-full',
        !collapsed &&
          'focus-visible:border-ring h-11 w-full justify-center font-bold focus-visible:border focus-visible:ring-0',
      )}
    >
      <SettingsIcon />
      {!collapsed && <span>Settings</span>}
    </RippleButton>
  )
}

export function UserSettings() {
  return (
    <ErrorBoundary
      fallback={(fallback) => <ChatSettingsFallback {...fallback} />}
    >
      <ChatSettingsDialog />
    </ErrorBoundary>
  )
}

function ChatSettingsFallback({ error }: FallbackProps) {
  const view = useView(USER_SETTINGS_VIEW)

  return (
    <Dialog open={view.active} onOpenChange={(next) => !next && view.close()}>
      <Dialog.Content className="max-w-md">
        <Dialog.Header>
          <Dialog.Title>Settings</Dialog.Title>
          <Dialog.Description>
            Your settings could not be loaded.
          </Dialog.Description>
        </Dialog.Header>
        <AlertMessage dismissible={false}>
          {extractErrorMessage(error)}
        </AlertMessage>
      </Dialog.Content>
    </Dialog>
  )
}

function ChatSettingsDialog() {
  const view = useView(USER_SETTINGS_VIEW)
  const open = view.active
  const openAgentEditor = useOpenAgentEditor(USER_SETTINGS_VIEW)
  const [switchPending, setSwitchPending] = useState(false)
  const activeTab = view.value ?? USER_SETTINGS_DEFAULT_TAB
  const activeTabLabel = USER_SETTINGS_TABS.find(
    (tab) => tab.value === activeTab,
  )?.label

  const settings = useSettings()
  const providerIds = useQuery(api.models.providerIds)
  const providers = useModelProviders()
  const mcpServers = useMcpServers()
  const libraryPrompts = usePromptItems('library')
  const libraryReminders = useReminderItems('library')
  const compactionPrompts = usePromptItems('compaction')
  const impersonationPrompts = usePromptItems('impersonation')

  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null)
  const [avatarCleared, setAvatarCleared] = useState(false)

  function handleStageAvatar(file: File | null) {
    setPendingAvatar(file)
    if (file) setAvatarCleared(false)
  }

  const form = useForm<SettingsFormValues>({
    defaultValues: defaultSettingsValues(),
  })

  const draft = useFormDraft(
    USER_SETTINGS_DRAFT_KEY,
    form,
    'your settings',
    withoutSecrets,
  )

  // Initialize after settings load, so staged profile fields are not reset
  // to empty mid-edit.
  const initialized = useRef(false)

  useEffect(() => {
    if (!open) {
      initialized.current = false
      return
    }
    // Every source needs to be available since the form owns the whole payload
    if (initialized.current || !settings || !providers || !mcpServers) return

    draft.sync(
      loadedSettingsValues({
        settings,
        providers,
        mcpServers,
        libraryPrompts,
        libraryReminders,
        compactionPrompts,
        impersonationPrompts,
        override: getSettingsOverride(),
      }),
    )
    initialized.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settings, providers, mcpServers])

  // Appearance is previewed inside the dialog, while its tab is open
  const previewing = open && activeTab === 'appearance'
  const previewColor = useWatch({
    control: form.control,
    name: 'themeColor',
  })
  const previewMode = useWatch({
    control: form.control,
    name: 'themeMode',
  })
  const overrideFonts = useWatch({
    control: form.control,
    name: 'override.fonts.enabled',
  })
  const syncedUiFont = useWatch({
    control: form.control,
    name: 'uiFont',
  })
  const localUiFont = useWatch({
    control: form.control,
    name: 'override.fonts.uiFont',
  })
  const previewUiFont = overrideFonts ? localUiFont : syncedUiFont

  const themeScope = useScopedTheme(
    previewing ? previewColor : null,
    previewing ? previewMode : null,
  )
  const fontScope = useMemo<CSSProperties | undefined>(
    () =>
      previewing && previewUiFont
        ? ({ '--font-sans': getFontFamily(previewUiFont) } as CSSProperties)
        : undefined,
    [previewing, previewUiFont],
  )

  const isDirty =
    form.formState.isDirty || pendingAvatar !== null || avatarCleared

  function handleOpenChange(next: boolean) {
    if (next) {
      view.open(USER_SETTINGS_DEFAULT_TAB)
      return
    }
    if (isDirty || saving || security.pending) return
    view.close()
  }

  function handleClose() {
    if (security.pending) return
    view.close()
  }

  function discard() {
    form.reset()
    draft.clear()
    setPendingAvatar(null)
    setAvatarCleared(false)
  }

  function handleDiscard() {
    discard()
    handleClose()
  }

  // Back must not silently drop unsaved settings
  const closeGuard = useViewCloseGuard(USER_SETTINGS_VIEW, {
    isDirty,
    onDiscard: discard,
  })

  const persist = useUserSettingsPersistence({
    pendingAvatar,
    avatarCleared,
    setPendingAvatar,
    setAvatarCleared,
    form,
    draft,
  })

  const { saving, apply, save } = useSettingsSave(form, persist, handleClose)
  const security = useAccountSecurity({
    active: open && activeTab === 'user',
    settingsBusy: saving,
    hasUnsavedSettings: isDirty,
    onLoggedOut: () => {
      discard()
      view.close()
    },
  })

  function handleApply(event: React.SubmitEvent<HTMLFormElement>) {
    if (security.pending) {
      event.preventDefault()
      return
    }
    void apply(event)
  }

  function switchToAgents() {
    if (isDirty) setSwitchPending(true)
    else openAgentEditor()
  }

  function discardAndSwitch() {
    discard()
    openAgentEditor()
  }

  async function saveAndSwitch() {
    if (await apply()) openAgentEditor()
  }

  if (!settings) return null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <ThemeScope className={themeScope}>
        <Dialog.Content
          showCloseButton={false}
          style={fontScope}
          className={cn(
            'flex h-[min(95svh,900px)] max-w-3xl flex-col gap-0 p-0',
            themeScope,
          )}
        >
          <LoadingOverlay
            show={saving || security.pending}
            className="bg-background/40 rounded-lg backdrop-blur-none"
          />

          <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleApply}>
            <Dialog.Header className="px-6 py-4">
              <SettingsDialogTitle
                section={activeTabLabel}
                action={
                  <SettingsSwitchButton
                    target="agent"
                    disabled={saving || security.pending}
                    onClick={switchToAgents}
                  />
                }
              >
                Settings
              </SettingsDialogTitle>
            </Dialog.Header>
            <SettingsTabs
              value={activeTab}
              onValueChange={(tab: string) => {
                if (!security.pending) view.setValue(tab)
              }}
              className="border-border min-h-0 flex-1 border-t"
            >
              <SettingsTabs.List className="border-border">
                {USER_SETTINGS_TABS.map(({ value, label, icon: Icon }) => (
                  <SettingsTabs.Trigger
                    key={value}
                    value={value}
                    icon={<Icon />}
                    aria-label={label}
                  >
                    {label}
                  </SettingsTabs.Trigger>
                ))}
              </SettingsTabs.List>

              <SettingsTabs.Content value="user">
                <ProfileSettings
                  control={form.control}
                  avatarId={settings.avatarId}
                  pendingAvatar={pendingAvatar}
                  avatarCleared={avatarCleared}
                  onStageAvatar={handleStageAvatar}
                  onClearAvatar={() => setAvatarCleared(true)}
                />
                <AccountSecuritySettings security={security} />
              </SettingsTabs.Content>

              <SettingsTabs.Content value="behavior">
                <BehaviorSettings control={form.control} />
              </SettingsTabs.Content>

              <SettingsTabs.Content value="appearance">
                <AppearanceSettings
                  control={form.control}
                  setValue={form.setValue}
                />
              </SettingsTabs.Content>

              <SettingsTabs.Content value="models">
                <ModelSettings providers={providerIds} form={form} />
              </SettingsTabs.Content>

              <SettingsTabs.Content
                value="skills"
                className="flex min-h-0 min-w-0 flex-col overflow-hidden"
              >
                <SkillLibrary />
              </SettingsTabs.Content>
              <SettingsTabs.Content value="tools">
                <SettingsList>
                  <Controller
                    control={form.control}
                    name="allowInteractiveShells"
                    render={({ field }) => (
                      <SettingsList.Switch
                        label="Allow interactive shells"
                        description="Allow shell commands to wait for your input."
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                </SettingsList>
                <Controller
                  control={form.control}
                  name="shell"
                  render={({ field }) => (
                    <ShellSettings
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
                <WebSearchSettings control={form.control} />
                <McpSettings control={form.control} />
              </SettingsTabs.Content>
            </SettingsTabs>

            <SettingsFooter
              isDirty={isDirty}
              busy={saving || security.pending}
              onClose={handleClose}
              onDiscard={handleDiscard}
              onSave={save}
            />
          </form>
          <AccountSecurityForm security={security} />
        </Dialog.Content>
      </ThemeScope>

      <ConfirmDialog
        open={switchPending || closeGuard.pending}
        onOpenChange={(o) => {
          if (o) return
          setSwitchPending(false)
          closeGuard.cancel()
        }}
        variant="destructive"
        title={
          switchPending ? 'Save changes before switching?' : 'Discard changes?'
        }
        description={
          switchPending
            ? 'You have unsaved changes to your settings.'
            : 'Your unsaved changes will be lost.'
        }
        confirmText="Discard"
        cancelText="Keep editing"
        onConfirm={switchPending ? discardAndSwitch : closeGuard.confirm}
        extraAction={
          switchPending
            ? {
                text: 'Save',
                variant: 'primary',
                onConfirm: saveAndSwitch,
              }
            : undefined
        }
      />
      <AccountLogoutConfirmation security={security} />
    </Dialog>
  )
}

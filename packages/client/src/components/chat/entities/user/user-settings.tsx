import {
  AlertMessage,
  ConfirmDialog,
  Dialog,
  ErrorBoundary,
  type FallbackProps,
  LoadingOverlay,
  RippleButton,
  type RippleButtonProps,
  SettingsFooter,
  SettingsList,
  SettingsTabs,
} from '@/components/ui'
import { getFontFamily } from '@/fonts'
import {
  useMcpServers,
  useModelProviders,
  usePromptItems,
  useReminderItems,
  useSettings,
} from '@/hooks/chat'
import { useFormDraft } from '@/hooks/chat/form-draft'
import { useSettingsSave } from '@/hooks/chat/settings-save'
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
  BotIcon,
  PaletteIcon,
  SettingsIcon,
  UserIcon,
  WrenchIcon,
} from 'lucide-react'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'

import { ShellSettings } from '../shell-settings'
import { AppearanceSettings } from './appearance-settings'
import { BehaviorSettings } from './behavior-settings'
import { McpSettings } from './mcp-settings'
import { ModelSettings } from './model-settings'
import { ProfileSettings } from './profile-settings'
import type { SettingsFormValues } from './settings-schema'
import { useUserSettingsPersistence } from './user-settings-persistence'
import {
  defaultSettingsValues,
  loadedSettingsValues,
  withoutSecrets,
} from './user-settings-values'
import { WebSearchSettings } from './web-search-settings'

/** `?view=` segment owned by user settings; its value is the active tab. */
const USER_SETTINGS_VIEW = 'settings'
const USER_SETTINGS_DEFAULT_TAB = 'user'

export type ChatSettingsProps = RippleButtonProps & {
  collapsed?: boolean
}

export function ChatSettingsButton({
  collapsed = false,
  ...props
}: ChatSettingsProps) {
  const trigger = (
    <RippleButton
      {...props}
      variant="stealth"
      size={!collapsed ? 'default' : 'icon'}
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

  return (
    <ErrorBoundary
      fallback={(fallback) => (
        <ChatSettingsFallback {...fallback} trigger={trigger} />
      )}
    >
      <ChatSettingsDialog trigger={trigger} />
    </ErrorBoundary>
  )
}

function ChatSettingsFallback({
  error,
  trigger,
}: FallbackProps & { trigger: React.ReactElement<Record<string, unknown>> }) {
  const view = useView(USER_SETTINGS_VIEW)

  return (
    <Dialog open={view.active} onOpenChange={(next) => !next && view.close()}>
      <Dialog.Trigger render={trigger} />
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

function ChatSettingsDialog({
  trigger,
}: {
  trigger: React.ReactElement<Record<string, unknown>>
}) {
  const view = useView(USER_SETTINGS_VIEW)
  const open = view.active
  const activeTab = view.value ?? USER_SETTINGS_DEFAULT_TAB

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
    if (isDirty || saving) return
    view.close()
  }

  function handleClose() {
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

  if (!settings) return null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger render={trigger} />
      <ThemeScope className={themeScope}>
        <Dialog.Content
          showCloseButton={false}
          style={fontScope}
          className={cn(
            'flex h-[min(95svh,800px)] flex-col p-0 sm:max-w-2xl',
            themeScope,
          )}
        >
          <LoadingOverlay
            show={saving}
            className="bg-background/40 rounded-lg backdrop-blur-none"
          />

          <form className="flex min-h-0 flex-1 flex-col" onSubmit={apply}>
            <Dialog.Header className="px-6 py-4">
              <Dialog.Title>Settings</Dialog.Title>
            </Dialog.Header>
            <SettingsTabs
              value={activeTab}
              onValueChange={(tab: string) => view.setValue(tab)}
              className="border-border min-h-0 flex-1 border-t"
            >
              <SettingsTabs.List className="border-border">
                <SettingsTabs.Trigger value="user" icon={<UserIcon />}>
                  Profile
                </SettingsTabs.Trigger>
                <SettingsTabs.Trigger value="behavior" icon={<ActivityIcon />}>
                  Behavior
                </SettingsTabs.Trigger>
                <SettingsTabs.Trigger value="models" icon={<BotIcon />}>
                  Models
                </SettingsTabs.Trigger>
                <SettingsTabs.Trigger value="tools" icon={<WrenchIcon />}>
                  Tools
                </SettingsTabs.Trigger>
                <SettingsTabs.Trigger value="appearance" icon={<PaletteIcon />}>
                  Appearance
                </SettingsTabs.Trigger>
              </SettingsTabs.List>

              <SettingsTabs.Content value="user" title="User">
                <ProfileSettings
                  control={form.control}
                  avatarId={settings.avatarId}
                  pendingAvatar={pendingAvatar}
                  avatarCleared={avatarCleared}
                  onStageAvatar={handleStageAvatar}
                  onClearAvatar={() => setAvatarCleared(true)}
                />
              </SettingsTabs.Content>

              <SettingsTabs.Content value="behavior" title="Behavior">
                <BehaviorSettings control={form.control} />
              </SettingsTabs.Content>

              <SettingsTabs.Content value="appearance" title="Appearance">
                <AppearanceSettings
                  control={form.control}
                  setValue={form.setValue}
                />
              </SettingsTabs.Content>

              <SettingsTabs.Content value="models" title="Models">
                <ModelSettings
                  control={form.control}
                  setValue={form.setValue}
                  providers={providerIds}
                />
              </SettingsTabs.Content>

              <SettingsTabs.Content value="tools" title="Tools">
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
              busy={saving}
              onClose={handleClose}
              onDiscard={handleDiscard}
              onSave={save}
            />
          </form>
        </Dialog.Content>
      </ThemeScope>

      <ConfirmDialog
        open={closeGuard.pending}
        onOpenChange={(o) => !o && closeGuard.cancel()}
        variant="destructive"
        title="Discard changes?"
        description="Your unsaved changes will be lost."
        confirmText="Discard"
        cancelText="Keep editing"
        onConfirm={closeGuard.confirm}
      />
    </Dialog>
  )
}

/** Drops API keys before the draft is written to local storage. */

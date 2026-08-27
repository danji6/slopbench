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
  SettingsTabs,
} from '@/components/ui'
import { getFontFamily } from '@/fonts'
import {
  useClearProfileAvatar,
  useMcpServers,
  useMcpServersSave,
  useModelProviders,
  useModelProvidersSave,
  usePromptItems,
  useReminderItems,
  useSettings,
  useSettingsUpdate,
  useUploadProfileAvatar,
  useUserPromptSetsSave,
} from '@/hooks/chat'
import { useFormDraft } from '@/hooks/chat/form-draft'
import { useSettingsSave } from '@/hooks/chat/settings-save'
import { FONT_OVERRIDE_KEYS } from '@/hooks/font'
import { useScopedTheme } from '@/hooks/theme'
import { useView, useViewCloseGuard } from '@/hooks/view'
import { USER_SETTINGS_DRAFT_KEY } from '@/lib/chat/editor-draft-store'
import { extractErrorMessage } from '@/lib/errors'
import {
  type SettingsOverride,
  getSettingsOverride,
  setSettingsOverride,
} from '@/lib/settings-override'
import { snapshotTheme } from '@/lib/theme-worker'
import { cn, generateId } from '@/lib/utils'
import { ThemeScope } from '@/providers/theme-scope'
import { api } from '@sb/convex/_generated/api'
import {
  DEFAULT_SETTINGS,
  SOURCE_COLOR,
  createDefaultCompactionPrompts,
  createDefaultImpersonationPrompts,
} from '@sb/convex/model/defaults'
import { type WebSearchInstance, isSearchEngineId } from '@sb/core/types'
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
import type {
  SettingsFormValues,
  WebSearchInstanceFormValues,
} from './settings-schema'
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
  const updateSettings = useSettingsUpdate()
  const uploadAvatar = useUploadProfileAvatar()
  const clearAvatar = useClearProfileAvatar()
  const providerIds = useQuery(api.models.providerIds)
  const providers = useModelProviders()
  const saveProviders = useModelProvidersSave()
  const mcpServers = useMcpServers()
  const saveMcpServers = useMcpServersSave()
  const savePromptSets = useUserPromptSetsSave()
  const globalPrompts = usePromptItems('global')
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
    defaultValues: {
      displayName: '',
      scrollMode: DEFAULT_SETTINGS.scrollMode,
      mathMode: DEFAULT_SETTINGS.mathMode,
      autoTitle: DEFAULT_SETTINGS.autoTitle,
      invertSend: DEFAULT_SETTINGS.invertSend,
      groupBySender: DEFAULT_SETTINGS.groupBySender,
      avatarSize: DEFAULT_SETTINGS.avatarSize,
      titleModel: null,
      webSearchInstances: DEFAULT_SETTINGS.webSearchInstances,
      mcpServers: [],
      uiFont: DEFAULT_SETTINGS.uiFont,
      chatFont: DEFAULT_SETTINGS.chatFont,
      monoFont: DEFAULT_SETTINGS.monoFont,
      chatFontSize: DEFAULT_SETTINGS.chatFontSize,
      override: {
        fonts: {
          enabled: false,
          uiFont: DEFAULT_SETTINGS.uiFont,
          chatFont: DEFAULT_SETTINGS.chatFont,
          monoFont: DEFAULT_SETTINGS.monoFont,
          chatFontSize: DEFAULT_SETTINGS.chatFontSize,
        },
      },
      chatWidth: DEFAULT_SETTINGS.chatWidth,
      customCss: DEFAULT_SETTINGS.customCss,
      shell: DEFAULT_SETTINGS.shell,
      themeColor: SOURCE_COLOR,
      themeMode: DEFAULT_SETTINGS.themeMode,
      globalPrompts: [],
      libraryPrompts: [],
      libraryReminders: [],
      compactionPrompts: createDefaultCompactionPrompts(),
      impersonationPrompts: createDefaultImpersonationPrompts(),
      providers: [],
    },
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

    const override = getSettingsOverride()
    const fontsEnabled = FONT_OVERRIDE_KEYS.some(
      (key) => override[key] !== undefined,
    )

    draft.sync({
      displayName: settings.displayName ?? '',
      scrollMode: settings.scrollMode,
      mathMode: settings.mathMode,
      autoTitle: settings.autoTitle,
      invertSend: settings.invertSend,
      groupBySender: settings.groupBySender,
      avatarSize: settings.avatarSize,
      titleModel: settings.titleModel ?? null,
      webSearchInstances: settings.webSearchInstances.map((i) => ({
        ...i,
        _clientId: generateId(),
      })),
      mcpServers: (mcpServers ?? []).map((server) => ({
        id: server.id,
        serverId: server._id,
        label: server.label,
        url: server.url,
        transport: server.transport,
        enabled: server.enabled,
        hasKey: server.hasKey,
        tools: server.tools,
        _clientId: generateId(),
      })),
      uiFont: settings.uiFont,
      chatFont: settings.chatFont,
      monoFont: settings.monoFont,
      chatFontSize: settings.chatFontSize,
      override: {
        fonts: {
          enabled: fontsEnabled,
          uiFont: override.uiFont ?? settings.uiFont,
          chatFont: override.chatFont ?? settings.chatFont,
          monoFont: override.monoFont ?? settings.monoFont,
          chatFontSize: override.chatFontSize ?? settings.chatFontSize,
        },
      },
      chatWidth: settings.chatWidth,
      customCss: settings.customCss,
      shell: settings.shell,
      themeColor: settings.theme?.source ?? SOURCE_COLOR,
      themeMode: settings.themeMode,
      globalPrompts: globalPrompts as SettingsFormValues['globalPrompts'],
      libraryPrompts: libraryPrompts as SettingsFormValues['libraryPrompts'],
      libraryReminders: libraryReminders,
      compactionPrompts: compactionPrompts.length
        ? compactionPrompts
        : createDefaultCompactionPrompts(),
      impersonationPrompts: impersonationPrompts.length
        ? impersonationPrompts
        : createDefaultImpersonationPrompts(),
      providers: (providers ?? []).map((p) => ({
        id: p.id,
        baseURL: p.baseURL,
        extraHeaders: p.extraHeaders,
        enabled: p.enabled,
        models: p.models,
        hasKey: p.hasKey,
        _clientId: generateId(),
      })),
    })
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

  async function persist(values: SettingsFormValues) {
    if (pendingAvatar) {
      await uploadAvatar(pendingAvatar)
      setPendingAvatar(null)
    } else if (avatarCleared) {
      await clearAvatar()
    }
    setAvatarCleared(false)
    await updateSettings({
      patch: {
        displayName: values.displayName,
        scrollMode: values.scrollMode,
        mathMode: values.mathMode,
        autoTitle: values.autoTitle,
        invertSend: values.invertSend,
        groupBySender: values.groupBySender,
        avatarSize: values.avatarSize,
        titleModel: values.titleModel ?? undefined,
        webSearchInstances: normalizeWebSearchInstances(
          values.webSearchInstances,
        ),
        uiFont: values.uiFont,
        chatFont: values.chatFont,
        monoFont: values.monoFont,
        chatFontSize: values.chatFontSize,
        chatWidth: values.chatWidth,
        customCss: values.customCss,
        shell: values.shell.trim(),
        theme: values.themeColor
          ? await snapshotTheme(values.themeColor)
          : undefined,
        themeMode: values.themeMode,
      },
    })
    await savePromptSets({
      globalPrompts: values.globalPrompts,
      libraryPrompts: values.libraryPrompts,
      libraryReminders: values.libraryReminders,
      compactionPrompts: values.compactionPrompts,
      impersonationPrompts: values.impersonationPrompts,
    })
    await saveProviders({
      providers: values.providers.map((p) => ({
        key: p.id,
        baseURL: p.baseURL,
        extraHeaders: p.extraHeaders,
        enabled: p.enabled,
        models: p.models.map((model) => ({
          id: model.id,
          label: model.label,
          contextWindow: model.contextWindow,
          reasoning: model.reasoning,
          extraParameters: model.extraParameters,
        })),
        apiKey: p.apiKey,
      })),
    })
    await saveMcpServers({
      servers: values.mcpServers.map((server) => ({
        key: server.id,
        label: server.label,
        url: server.url,
        transport: server.transport,
        enabled: server.enabled,
        apiKey: server.apiKey,
        tools: server.tools?.map((tool) => ({
          name: tool.name,
          description: tool.description,
          descriptionOverride: tool.descriptionOverride,
          inputSchema: tool.inputSchema,
        })),
      })),
    })
    const { enabled, ...fontOverride } = values.override.fonts
    if (enabled) {
      setSettingsOverride(fontOverride)
    } else {
      const cleared: SettingsOverride = {}
      for (const key of FONT_OVERRIDE_KEYS) cleared[key] = undefined
      setSettingsOverride(cleared)
    }
    form.reset(values)
    draft.clear()
  }

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
          <LoadingOverlay show={saving} className="rounded-lg" />

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
                <ModelSettings control={form.control} providers={providerIds} />
              </SettingsTabs.Content>

              <SettingsTabs.Content value="tools" title="Tools">
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
function withoutSecrets(values: SettingsFormValues): SettingsFormValues {
  return {
    ...values,
    providers: values.providers.map(({ apiKey: _, ...p }) => p),
    mcpServers: values.mcpServers.map(({ apiKey: _, ...server }) => server),
  }
}

function normalizeWebSearchInstances(
  instances: WebSearchInstanceFormValues[],
): WebSearchInstance[] {
  const seen = new Set<string>()
  const normalized: WebSearchInstance[] = []

  for (const instance of instances) {
    const url = instance.url.trim()
    if (!url || !isSearchEngineId(instance.engine)) continue

    const key = `${instance.engine}:${url}`
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push({ engine: instance.engine, url })
  }

  return normalized
}

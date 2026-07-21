import {
  Dialog,
  RippleButton,
  type RippleButtonProps,
  SettingsFooter,
  SettingsTabs,
} from '@/components/ui'
import {
  useClearProfileAvatar,
  useSettings,
  useSettingsUpdate,
  useUploadProfileAvatar,
} from '@/hooks/chat'
import { FONT_OVERRIDE_KEYS, setFontPreview } from '@/hooks/font'
import { setThemePreview } from '@/hooks/theme'
import {
  type SettingsOverride,
  getSettingsOverride,
  setSettingsOverride,
} from '@/lib/settings-override'
import { snapshotTheme } from '@/lib/theme-worker'
import { cn, generateId } from '@/lib/utils'
import { api } from '@sb/convex/_generated/api'
import {
  DEFAULT_SETTINGS,
  SOURCE_COLOR,
  createDefaultCompactionPrompts,
  createDefaultImpersonationPrompts,
  createDefaultPlanPrompts,
} from '@sb/convex/model/defaults'
import {
  type McpServer,
  type WebSearchInstance,
  isSearchEngineId,
} from '@sb/core/types'
import { useQuery } from 'convex/react'
import {
  ActivityIcon,
  BotIcon,
  PaletteIcon,
  SettingsIcon,
  UserIcon,
  WrenchIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'

import { AppearanceSettings } from './appearance-settings'
import { BehaviorSettings } from './behavior-settings'
import { McpSettings } from './mcp-settings'
import { ModelSettings } from './model-settings'
import { ProfileSettings } from './profile-settings'
import type {
  McpServerFormValues,
  ProviderFormValues,
  SettingsFormValues,
  WebSearchInstanceFormValues,
} from './settings-schema'
import { WebSearchSettings } from './web-search-settings'

export type ChatSettingsProps = RippleButtonProps & {
  collapsed?: boolean
}

export function ChatSettingsButton({
  collapsed = false,
  ...props
}: ChatSettingsProps) {
  return (
    <ChatSettingsDialog
      trigger={
        <RippleButton
          {...props}
          variant="stealth"
          size={!collapsed ? 'default' : 'icon'}
          className={cn(
            'text-muted-foreground rounded-full',
            !collapsed &&
              'focus-visible:border-ring h-11 w-full justify-center rounded-md font-bold focus-visible:border focus-visible:ring-0',
          )}
        >
          <SettingsIcon />
          {!collapsed && <span>Settings</span>}
        </RippleButton>
      }
    />
  )
}

function ChatSettingsDialog({
  trigger,
}: {
  trigger: React.ReactElement<Record<string, unknown>>
}) {
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('user')

  const settings = useSettings()
  const updateSettings = useSettingsUpdate()
  const uploadAvatar = useUploadProfileAvatar()
  const clearAvatar = useClearProfileAvatar()
  const providerIds = useQuery(api.models.providerIds)

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
      titleModel: null,
      webSearchInstances: DEFAULT_SETTINGS.webSearchInstances,
      mcpServers: DEFAULT_SETTINGS.mcpServers,
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
      themeColor: SOURCE_COLOR,
      themeMode: DEFAULT_SETTINGS.themeMode,
      globalPrompts: [],
      libraryPrompts: [],
      libraryReminders: [],
      compactionPrompts: createDefaultCompactionPrompts(),
      impersonationPrompts: createDefaultImpersonationPrompts(),
      planPrompts: createDefaultPlanPrompts(),
      providers: [],
    },
  })

  // Initialize after settings load, so staged profile fields are not reset
  // to empty mid-edit.
  const initialized = useRef(false)
  const themePreviewActive = useRef(false)
  const fontPreviewActive = useRef(false)

  const clearThemePreview = useCallback(() => {
    if (!themePreviewActive.current) return
    themePreviewActive.current = false
    setThemePreview(null)
  }, [])

  const clearFontPreview = useCallback(() => {
    if (!fontPreviewActive.current) return
    fontPreviewActive.current = false
    setFontPreview(null)
  }, [])

  const clearPreviews = useCallback(() => {
    clearThemePreview()
    clearFontPreview()
  }, [clearFontPreview, clearThemePreview])

  useEffect(() => {
    if (!open) {
      initialized.current = false
      return
    }
    if (initialized.current || !settings) return
    const override = getSettingsOverride()
    const fontsEnabled = FONT_OVERRIDE_KEYS.some(
      (key) => override[key] !== undefined,
    )
    form.reset({
      displayName: settings.displayName ?? '',
      scrollMode: settings.scrollMode,
      mathMode: settings.mathMode,
      autoTitle: settings.autoTitle,
      invertSend: settings.invertSend,
      groupBySender: settings.groupBySender,
      titleModel: settings.titleModel ?? null,
      webSearchInstances: settings.webSearchInstances.map((i) => ({
        ...i,
        _clientId: generateId(),
      })),
      mcpServers: settings.mcpServers ?? [],
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
      themeColor: settings.theme?.source ?? SOURCE_COLOR,
      themeMode: settings.themeMode,
      globalPrompts: settings.globalPrompts ?? [],
      libraryPrompts: settings.libraryPrompts ?? [],
      libraryReminders: settings.libraryReminders ?? [],
      compactionPrompts:
        settings.compactionPrompts ?? createDefaultCompactionPrompts(),
      impersonationPrompts:
        settings.impersonationPrompts ?? createDefaultImpersonationPrompts(),
      planPrompts: settings.planPrompts ?? createDefaultPlanPrompts(),
      providers: ((settings.modelProviders as ProviderFormValues[]) ?? []).map(
        (p) => ({
          ...p,
          _clientId: p._clientId ?? generateId(),
        }),
      ),
    })
    initialized.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settings])

  // Preview appearance changes live while the dialog is open
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

  // Theme preview
  useEffect(() => {
    if (!open || !initialized.current) return
    themePreviewActive.current = true
    setThemePreview({ themeColor: previewColor, themeMode: previewMode })
  }, [open, previewColor, previewMode])

  // UI Font preview
  useEffect(() => {
    if (!open || !initialized.current) return
    fontPreviewActive.current = true
    setFontPreview({ uiFont: previewUiFont })
  }, [open, previewUiFont])

  useEffect(() => clearPreviews, [clearPreviews])

  const isDirty =
    form.formState.isDirty || pendingAvatar !== null || avatarCleared

  function handleOpenChange(next: boolean) {
    if (!next && isDirty) return
    setOpen(next)
  }

  function handleClose() {
    setOpen(false)
  }

  function handleDiscard() {
    form.reset()
    setPendingAvatar(null)
    setAvatarCleared(false)
    handleClose()
  }

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
        titleModel: values.titleModel ?? undefined,
        webSearchInstances: normalizeWebSearchInstances(
          values.webSearchInstances,
        ),
        mcpServers: normalizeMcpServers(values.mcpServers),
        uiFont: values.uiFont,
        chatFont: values.chatFont,
        monoFont: values.monoFont,
        chatFontSize: values.chatFontSize,
        chatWidth: values.chatWidth,
        customCss: values.customCss,
        theme: values.themeColor
          ? await snapshotTheme(values.themeColor)
          : undefined,
        themeMode: values.themeMode,
        globalPrompts: values.globalPrompts,
        libraryPrompts: values.libraryPrompts,
        libraryReminders: values.libraryReminders,
        compactionPrompts: values.compactionPrompts,
        impersonationPrompts: values.impersonationPrompts,
        planPrompts: values.planPrompts,
        modelProviders: values.providers.map(({ _clientId: _, ...p }) => p),
      },
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
  }

  const apply = form.handleSubmit(persist)
  const save = form.handleSubmit(async (values) => {
    await persist(values)
    handleClose()
  })

  if (!settings) return null

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) clearPreviews()
      }}
    >
      <Dialog.Trigger render={trigger} />
      <Dialog.Content
        showCloseButton={false}
        className="flex h-[min(95svh,800px)] flex-col p-0 sm:max-w-2xl"
      >
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={apply}>
          <Dialog.Header className="px-6 py-4">
            <Dialog.Title>Settings</Dialog.Title>
          </Dialog.Header>
          <SettingsTabs
            value={activeTab}
            onValueChange={setActiveTab}
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
              <WebSearchSettings control={form.control} />
              <McpSettings control={form.control} />
            </SettingsTabs.Content>
          </SettingsTabs>

          <SettingsFooter
            isDirty={isDirty}
            onClose={handleClose}
            onDiscard={handleDiscard}
            onSave={save}
          />
        </form>
      </Dialog.Content>
    </Dialog>
  )
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

function normalizeMcpServers(servers: McpServerFormValues[]): McpServer[] {
  const normalized: McpServer[] = []

  for (const server of servers) {
    const url = server.url.trim()
    const label = server.label.trim()
    if (!url && !label) continue

    const apiKey = server.apiKey?.trim()
    const tools = server.tools?.map((tool) => {
      const override = tool.descriptionOverride?.trim()
      const { descriptionOverride: _omit, ...rest } = tool
      return override ? { ...rest, descriptionOverride: override } : rest
    })
    normalized.push({
      id: server.id,
      label,
      url,
      transport: server.transport,
      enabled: server.enabled,
      ...(apiKey ? { apiKey } : {}),
      ...(tools ? { tools } : {}),
    })
  }

  return normalized
}

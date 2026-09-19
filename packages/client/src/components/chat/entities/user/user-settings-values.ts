import {
  type useMcpServers,
  type useModelProviders,
  type usePromptItems,
  type useReminderItems,
  type useSettings,
} from '@/hooks/chat'
import { FONT_OVERRIDE_KEYS } from '@/hooks/font'
import { type SettingsOverride } from '@/lib/settings-override'
import { generateId } from '@/lib/utils'
import {
  DEFAULT_SETTINGS,
  SOURCE_COLOR,
  createDefaultCompactionPrompts,
  createDefaultImpersonationPrompts,
} from '@sb/convex/model/defaults'
import { type WebSearchInstance, isSearchEngineId } from '@sb/core/types'

import type {
  SettingsFormValues,
  WebSearchInstanceFormValues,
} from './settings-schema'

export function defaultSettingsValues() {
  return {
    displayName: '',
    scrollMode: DEFAULT_SETTINGS.scrollMode,
    mathMode: DEFAULT_SETTINGS.mathMode,
    autoTitle: DEFAULT_SETTINGS.autoTitle,
    invertSend: DEFAULT_SETTINGS.invertSend,
    groupBySender: DEFAULT_SETTINGS.groupBySender,
    followAgentThemeColor: DEFAULT_SETTINGS.followAgentThemeColor,
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
    allowInteractiveShells: DEFAULT_SETTINGS.allowInteractiveShells,
    themeColor: SOURCE_COLOR,
    themeMode: DEFAULT_SETTINGS.themeMode,
    libraryPrompts: [],
    libraryReminders: [],
    compactionPrompts: createDefaultCompactionPrompts(),
    impersonationPrompts: createDefaultImpersonationPrompts(),
    providers: [],
  }
}

type LoadedSettingsInput = {
  settings: NonNullable<ReturnType<typeof useSettings>>
  providers: NonNullable<ReturnType<typeof useModelProviders>>
  mcpServers: NonNullable<ReturnType<typeof useMcpServers>>
  libraryPrompts: ReturnType<typeof usePromptItems>
  libraryReminders: ReturnType<typeof useReminderItems>
  compactionPrompts: ReturnType<typeof usePromptItems>
  impersonationPrompts: ReturnType<typeof usePromptItems>
  override: SettingsOverride
}

export function loadedSettingsValues({
  settings,
  providers,
  mcpServers,
  libraryPrompts,
  libraryReminders,
  compactionPrompts,
  impersonationPrompts,
  override,
}: LoadedSettingsInput) {
  const fontsEnabled = FONT_OVERRIDE_KEYS.some(
    (key) => override[key] !== undefined,
  )
  return {
    displayName: settings.displayName ?? '',
    scrollMode: settings.scrollMode,
    mathMode: settings.mathMode,
    autoTitle: settings.autoTitle,
    invertSend: settings.invertSend,
    groupBySender: settings.groupBySender,
    followAgentThemeColor: settings.followAgentThemeColor,
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
    allowInteractiveShells: settings.allowInteractiveShells,
    themeColor: settings.theme?.source ?? SOURCE_COLOR,
    themeMode: settings.themeMode,
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
      models: p.models.map((model) => ({
        ...model,
        _clientId: generateId(),
      })),
      hasKey: p.hasKey,
      _clientId: generateId(),
    })),
  }
}

export function withoutSecrets(values: SettingsFormValues): SettingsFormValues {
  return {
    ...values,
    providers: values.providers.map(({ apiKey: _, ...p }) => p),
    mcpServers: values.mcpServers.map(({ apiKey: _, ...server }) => server),
  }
}

export function normalizeWebSearchInstances(
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

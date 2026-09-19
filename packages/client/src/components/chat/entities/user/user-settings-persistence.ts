import {
  useClearProfileAvatar,
  useMcpServersSave,
  useModelProvidersSave,
  useSettingsUpdate,
  useUploadProfileAvatar,
  useUserPromptSetsSave,
} from '@/hooks/chat'
import { FONT_OVERRIDE_KEYS } from '@/hooks/font'
import {
  type SettingsOverride,
  setSettingsOverride,
} from '@/lib/settings-override'
import { snapshotTheme } from '@/lib/theme-worker'
import type { UseFormReturn } from 'react-hook-form'

import type { SettingsFormValues } from './settings-schema'
import { normalizeWebSearchInstances } from './user-settings-values'

type PersistenceInput = {
  pendingAvatar: File | null
  avatarCleared: boolean
  setPendingAvatar: (file: File | null) => void
  setAvatarCleared: (cleared: boolean) => void
  form: UseFormReturn<SettingsFormValues>
  draft: { clear(): void }
}

/** Preserves the save sequence and acknowledges each successful local stage. */
export function useUserSettingsPersistence({
  pendingAvatar,
  avatarCleared,
  setPendingAvatar,
  setAvatarCleared,
  form,
  draft,
}: PersistenceInput) {
  const updateSettings = useSettingsUpdate()
  const uploadAvatar = useUploadProfileAvatar()
  const clearAvatar = useClearProfileAvatar()
  const saveProviders = useModelProvidersSave()
  const saveMcpServers = useMcpServersSave()
  const savePromptSets = useUserPromptSetsSave()

  return async function persist(values: SettingsFormValues) {
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
        followAgentThemeColor: values.followAgentThemeColor,
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
        allowInteractiveShells: values.allowInteractiveShells,
        theme: values.themeColor
          ? await snapshotTheme(values.themeColor)
          : undefined,
        themeMode: values.themeMode,
      },
    })
    await savePromptSets({
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
          inference: model.inference,
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
          allowInReadOnly: tool.allowInReadOnly,
          nameOverride: tool.nameOverride,
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
}

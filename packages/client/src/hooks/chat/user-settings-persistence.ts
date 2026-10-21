import { parseMcpLaunch } from '@/components/chat/entities/user/mcp-launch'
import type { SettingsFormValues } from '@/components/chat/entities/user/settings-schema'
import { normalizeWebSearchInstances } from '@/components/chat/entities/user/user-settings-values'
import {
  useClearProfileAvatar,
  useMcpServersSave,
  useSettingsUpdate,
  useUploadProfileAvatar,
  useUserPromptSetsSave,
} from '@/hooks/chat'
import { FONT_OVERRIDE_KEYS } from '@/hooks/font'
import { providerSaveInput } from '@/lib/provider-settings'
import {
  type SettingsOverride,
  setSettingsOverride,
} from '@/lib/settings-override'
import { snapshotTheme } from '@/lib/theme-worker'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { providerFeatures } from '@sb/core/provider-registry'
import { useAction, useMutation } from 'convex/react'
import type { UseFormReturn } from 'react-hook-form'

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
  const removeSetting = useMutation(api.settings.remove)
  const uploadAvatar = useUploadProfileAvatar()
  const clearAvatar = useClearProfileAvatar()
  const saveMcpServers = useMcpServersSave()
  const saveProviders = useMutation(api.providers.save)
  const discover = useAction(api.actions.providerConnections.discover)
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
        invertSend: values.invertSend,
        groupBySender: values.groupBySender,
        followAgentThemeColor: values.followAgentThemeColor,
        avatarSize: values.avatarSize,
        titleModel: values.titleModel ?? undefined,
        titleSystemPrompt: values.titleSystemPrompt,
        webSearchInstances: normalizeWebSearchInstances(
          values.webSearchInstances,
        ),
        uiFont: values.uiFont,
        chatFont: values.chatFont,
        monoFont: values.monoFont,
        chatFontSize: values.chatFontSize,
        chatWidth: values.chatWidth,
        customCss: values.customCss,
        codeBlockHighlighting: values.codeBlockHighlighting,
        codeBlockLineNumbers: values.codeBlockLineNumbers,
        shell: values.shell.trim(),
        allowInteractiveShells: values.allowInteractiveShells,
        theme: values.themeColor
          ? await snapshotTheme(values.themeColor)
          : undefined,
        themeMode: values.themeMode,
      },
    })
    if (!values.titleModel) await removeSetting({ key: 'titleModel' })
    await savePromptSets({
      libraryPrompts: values.libraryPrompts,
      libraryReminders: values.libraryReminders,
      compactionPrompts: values.compactionPrompts,
      impersonationPrompts: values.impersonationPrompts,
    })
    await saveMcpServers({
      servers: values.mcpServers.map((server) => ({
        key: server.id,
        label: server.label,
        url: server.url,
        ...(server.transport === 'stdio' ? parseMcpLaunch(server) : {}),
        command: server.transport === 'stdio' ? server.command : undefined,
        cwd: server.transport === 'stdio' ? server.cwd : undefined,
        startupTimeoutMs: server.startupTimeoutMs,
        requestTimeoutMs: server.requestTimeoutMs,
        maxTotalTimeoutMs: server.maxTotalTimeoutMs,
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

    const savedProviders = await saveProviders({
      connections: values.providers.map(providerSaveInput),
      removed: (values.removedProviders ?? []).map((row) => ({
        ...row,
        providerId: row.providerId as Id<'modelProviders'>,
      })),
    })

    const providers = values.providers.map((row) => {
      const saved = savedProviders.find(
        (connection) =>
          connection.clientId === (row._clientId ?? row.connectionId),
      )!
      return {
        ...row,
        apiKey: undefined,
        hasKey: row.apiKey !== undefined ? !!row.apiKey : row.hasKey,
        connectionId: saved.providerId,
        configRevision: saved.configRevision,
        previewId: undefined,
      }
    })

    form.reset({ ...values, providers, removedProviders: [] })
    for (const row of providers) {
      if (row.enabled && providerFeatures(row.id, row.auth).discovery)
        void discover({ providerId: row.connectionId }).catch(() => {})
    }
    draft.clear()
  }
}

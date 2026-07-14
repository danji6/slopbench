import { getFontFamily } from '@/fonts'
import { useStableValue } from '@/hooks'
import {
  useActiveAgent,
  useActiveSession,
  useActiveSessionStatus,
  useSettings,
  useValidatedSessionId,
} from '@/hooks/chat'
import { resolveFonts, useSettingsOverride } from '@/hooks/font'
import { useTheme, useThemePreview } from '@/hooks/theme'
import { type CSSProperties, useMemo, useSyncExternalStore } from 'react'

import type { ChatProps } from './chat-types'
import type { AgentItem } from './sessions/agent-combobox'

type ChatShellState = {
  activeSessionId: string | null
  activeAgentName?: string
  activeAgentDisplay?: AgentItem
  style: CSSProperties
}

export function useChatShellState(
  layoutConstraint: ChatProps['layoutConstraint'],
): ChatShellState {
  const activeSessionId = useValidatedSessionId()
  const activeSession = useActiveSession()
  const activeAgent = useActiveAgent()
  const sessionStatus = useActiveSessionStatus()
  const settings = useSettings()
  const override = useSettingsOverride()
  const preview = useThemePreview()
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  const globalThemeColor = settings?.theme?.source ?? null
  const globalThemeMode =
    preview.themeMode !== undefined
      ? preview.themeMode
      : (settings?.themeMode ?? null)
  const agentThemeColor = activeAgent?.theme?.source ?? null
  const nextThemeColor =
    preview.themeColor !== undefined
      ? preview.themeColor
      : agentThemeColor || globalThemeColor

  const preserveAgent =
    sessionStatus === 'loading' ||
    Boolean(activeSessionId && activeSession?.activeAgentId && !activeAgent)
  const activeAgentName = useStableValue(activeAgent?.name, preserveAgent)
  const activeAgentId = activeAgent?._id
  const activeAgentAvatarId = activeAgent?.avatarId

  // Display fallback to avoid flickers during session load
  const nextActiveAgentDisplay = useMemo<AgentItem | undefined>(
    () =>
      activeAgentId && activeAgentName
        ? {
            id: activeAgentId,
            name: activeAgentName,
            avatarId: activeAgentAvatarId,
          }
        : undefined,
    [activeAgentId, activeAgentName, activeAgentAvatarId],
  )

  const activeAgentDisplay = useStableValue(
    nextActiveAgentDisplay,
    preserveAgent,
  )

  const resolvedThemeColor = useStableValue(
    nextThemeColor || null,
    sessionStatus === 'loading' && preview.themeColor === undefined,
  )

  useTheme(resolvedThemeColor || null, 'you', globalThemeMode)

  const fonts = resolveFonts(settings, override)

  return {
    activeSessionId,
    activeAgentName,
    activeAgentDisplay,
    style: {
      width: `100${layoutConstraint || '%'}`,
      ...(mounted &&
        settings && {
          '--chat-font-family': getFontFamily(fonts.chatFont),
          '--chat-font-size': `${fonts.chatFontSize}px`,
        }),
    } as CSSProperties,
  }
}

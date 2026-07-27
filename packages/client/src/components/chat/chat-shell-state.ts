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
import { useTheme } from '@/hooks/theme'
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
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  const globalThemeColor = settings?.theme?.source ?? null
  const globalThemeMode = settings?.themeMode ?? null
  const agentThemeColor = activeAgent?.theme?.source ?? null
  const nextThemeColor = agentThemeColor || globalThemeColor

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
    sessionStatus === 'loading',
  )

  useTheme(resolvedThemeColor || null, 'you', globalThemeMode)

  const fonts = resolveFonts(settings, override)
  const chatFont = mounted && settings ? fonts.chatFont : null
  const chatFontSize = mounted && settings ? fonts.chatFontSize : null

  const style = useMemo(
    () =>
      ({
        width: `100${layoutConstraint || '%'}`,
        ...(chatFont !== null && {
          '--chat-font-family': getFontFamily(chatFont),
          '--chat-font-size': `${chatFontSize}px`,
        }),
      }) as CSSProperties,
    [layoutConstraint, chatFont, chatFontSize],
  )

  return {
    activeSessionId,
    activeAgentName,
    activeAgentDisplay,
    style,
  }
}

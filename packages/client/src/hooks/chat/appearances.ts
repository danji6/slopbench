import { useIsDarkMode } from '@/hooks/theme'
import { resolveMessageTheme } from '@/lib/chat/message-theme'
import type { Look } from '@/lib/chat/scoped-appearance'
import type { MessageRecord } from '@/lib/chat/types'
import { schemeToCssVars, themeVars } from '@/lib/theme'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { DEFAULT_SETTINGS, SOURCE_COLOR } from '@sb/convex/model/defaults'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { useMemo } from 'react'

import { useActiveAgent } from './agent'
import { useActiveSessionId } from './session'
import { useSettings } from './settings'

/** Resolves the sending agent's current styling, shared across its message rows. */
export function useMessageAppearance(
  role: string,
  record?: Pick<MessageRecord, 'sender'>,
) {
  const settings = useSettings()
  const { agent, activeAgent, fromAgent } = useMessageAgent(role, record)
  const isDark = useIsDarkMode()
  const theme = resolveMessageTheme({
    fromAgent,
    followAgentThemeColor: settings?.followAgentThemeColor ?? false,
    userTheme: settings?.theme,
    agentTheme: fromAgent ? agent?.theme : activeAgent?.theme,
  })

  const vars = useMemo(() => {
    const scheme = theme && (isDark ? theme.dark : theme.light)
    if (scheme) return schemeToCssVars(scheme)
    return themeVars(SOURCE_COLOR, isDark)
  }, [theme, isDark])

  const look: Look = {
    css: [settings?.customCss, agent?.customCss],
    vars,
    isDark,
  }
  const code = {
    highlighting:
      agent?.codeBlockHighlighting ??
      settings?.codeBlockHighlighting ??
      DEFAULT_SETTINGS.codeBlockHighlighting,
    lineNumbers:
      agent?.codeBlockLineNumbers ??
      settings?.codeBlockLineNumbers ??
      DEFAULT_SETTINGS.codeBlockLineNumbers,
  }
  return { look, code }
}

/** Uses the active agent only for previews without a saved sender. */
function useMessageAgent(role: string, record?: Pick<MessageRecord, 'sender'>) {
  const activeAgent = useActiveAgent()
  const sessionId = useActiveSessionId()
  const fromAgent = record
    ? record.sender.type === 'agent'
    : role === 'assistant'
  const agentId = record?.sender.type === 'agent' ? record.sender.id : undefined
  const appearance = useQuery(
    api.appearances.get,
    agentId
      ? {
          agentId,
          sessionId: (sessionId as Id<'sessions'> | null) ?? undefined,
        }
      : 'skip',
  )
  // Prompt previews have no persisted sender; only those use the picked agent
  const agent = record ? appearance : fromAgent ? activeAgent : null
  return { agent, activeAgent, fromAgent }
}

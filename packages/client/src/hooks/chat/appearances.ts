import { useIsDarkMode } from '@/hooks/theme'
import type { Look } from '@/lib/chat/scoped-appearance'
import type { MessageRecord } from '@/lib/chat/types'
import { schemeToCssVars, themeVars } from '@/lib/theme'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { SOURCE_COLOR } from '@sb/convex/model/defaults'
import type { ThemeSnapshot } from '@sb/convex/types'
import { useMemo } from 'react'

import { useActiveAgent } from './agent'
import { createMediaUrlStore } from './media-urls'
import { useSettings } from './settings'

export type Appearance = { css?: string; theme?: ThemeSnapshot }

const store = createMediaUrlStore(api.appearances.getMap)

/** Resolves every message look on screen in one query. */
export const AppearanceProvider = store.Provider

/** Eagerly adds looks to the shared subscription before they render. */
export const registerAppearanceIds = store.register

/** The theme and custom css a message was sent with. */
export function useAppearance(
  appearanceId?: Id<'appearances'>,
): Appearance | null {
  return store.useMediaUrl(appearanceId) ?? null
}

/** The look of a message, built in layers with the user's and the agent's theming. */
export function useMessageLook(
  role: string,
  record?: Pick<MessageRecord, 'sender' | 'appearanceId'>,
): Look {
  const own = useAppearance(record?.appearanceId)
  const settings = useSettings()
  const agent = useActiveAgent()
  const isDark = useIsDarkMode()

  const fromAgent = record?.sender
    ? record.sender.type === 'agent'
    : role === 'assistant'

  const userCss = (fromAgent ? undefined : own?.css) ?? settings?.customCss
  const agentCss = fromAgent ? own?.css : agent?.customCss
  const theme = own?.theme ?? (fromAgent ? undefined : settings?.theme)

  const vars = useMemo(() => {
    const scheme = theme && (isDark ? theme.dark : theme.light)
    if (scheme) return schemeToCssVars(scheme)
    return fromAgent ? undefined : themeVars(SOURCE_COLOR, isDark)
  }, [theme, isDark, fromAgent])

  return { css: [userCss, agentCss], vars, isDark }
}

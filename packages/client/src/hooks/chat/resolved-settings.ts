import type { MathMode, ScrollMode, ThemeSnapshot } from '@/lib/chat'
import { DEFAULT_SETTINGS } from '@sb/convex/model/defaults'
import { useMemo } from 'react'

import { useActiveAgent } from './agent'
import { useSettings } from './settings'

/**
 * Settings to which the `agent ?? user ?? default` precedence resolution applies.
 * Compaction/impersonation prompts are excluded as those resolve server-side.
 */
export type ResolvedSettings = {
  scrollMode: ScrollMode
  mathMode: MathMode
  chatWidth: number
  customCss: string
  theme?: ThemeSnapshot
}

export function useResolvedSettings(): ResolvedSettings {
  const activeAgent = useActiveAgent()
  const settings = useSettings()

  return useMemo(() => {
    const pick = <K extends keyof ResolvedSettings>(key: K) =>
      (activeAgent as Partial<ResolvedSettings> | null)?.[key] ??
      (settings as Partial<ResolvedSettings> | null | undefined)?.[key]

    return {
      scrollMode: pick('scrollMode') ?? DEFAULT_SETTINGS.scrollMode,
      mathMode: pick('mathMode') ?? DEFAULT_SETTINGS.mathMode,
      chatWidth: pick('chatWidth') ?? DEFAULT_SETTINGS.chatWidth,
      customCss: pick('customCss') ?? DEFAULT_SETTINGS.customCss,
      theme: pick('theme'),
    }
  }, [activeAgent, settings])
}

export function useInvertSend(): boolean {
  const settings = useSettings()
  return settings?.invertSend ?? DEFAULT_SETTINGS.invertSend
}

export function useScrollMode(): ScrollMode {
  return useResolvedSettings().scrollMode
}

export function useMathMode(): MathMode {
  return useResolvedSettings().mathMode
}

export function useChatWidth(): number {
  return useResolvedSettings().chatWidth
}

import type { ThemeSnapshot } from '@sb/convex/types'

type MessageThemeOptions = {
  fromAgent: boolean
  followAgentThemeColor: boolean
  snapshot?: ThemeSnapshot
  userTheme?: ThemeSnapshot
  agentTheme?: ThemeSnapshot
}

/** Resolves the live palette for a message without changing its snapshot. */
export function resolveMessageTheme({
  fromAgent,
  followAgentThemeColor,
  snapshot,
  userTheme,
  agentTheme,
}: MessageThemeOptions): ThemeSnapshot | undefined {
  if (fromAgent) return snapshot
  if (followAgentThemeColor && agentTheme) return agentTheme
  return snapshot ?? userTheme
}

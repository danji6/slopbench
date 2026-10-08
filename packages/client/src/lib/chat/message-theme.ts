import type { ThemeSnapshot } from '@sb/convex/types'

type MessageThemeOptions = {
  fromAgent: boolean
  followAgentThemeColor: boolean
  userTheme?: ThemeSnapshot
  agentTheme?: ThemeSnapshot
}

/** Resolves the current palette for the sender of a message. */
export function resolveMessageTheme({
  fromAgent,
  followAgentThemeColor,
  userTheme,
  agentTheme,
}: MessageThemeOptions): ThemeSnapshot | undefined {
  if (fromAgent) return agentTheme
  if (followAgentThemeColor && agentTheme) return agentTheme
  return userTheme
}

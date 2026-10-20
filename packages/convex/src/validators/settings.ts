import { SEARCH_ENGINE_IDS } from '@sb/core/types'
import { v } from 'convex/values'

/** Resolved theme variables as their hex values. */
export const schemeColorsValidator = v.record(v.string(), v.string())

export const themeSnapshotValidator = v.object({
  source: v.string(),
  light: schemeColorsValidator,
  dark: schemeColorsValidator,
})

export const searchEngineValidator = v.union(
  ...SEARCH_ENGINE_IDS.map((id) => v.literal(id)),
)

export const webSearchInstanceValidator = v.object({
  engine: searchEngineValidator,
  url: v.string(),
})

export const scrollModeValidator = v.union(
  v.literal('follow'),
  v.literal('into-view'),
)

export const mathModeValidator = v.union(
  v.literal('off'),
  v.literal('single'),
  v.literal('double'),
)

export const themeValidator = v.union(
  v.literal('light'),
  v.literal('dark'),
  v.literal('system'),
)

/** Settings that a user configures globally and an agent may override. */
export const overridableFields = {
  scrollMode: v.optional(scrollModeValidator),
  customCss: v.optional(v.string()),
  theme: v.optional(themeSnapshotValidator),
  mathMode: v.optional(mathModeValidator),
  chatWidth: v.optional(v.number()),
  codeBlockHighlighting: v.optional(v.boolean()),
  codeBlockLineNumbers: v.optional(v.boolean()),
  /** Program name or path the shell tool uses to execute commands. */
  shell: v.optional(v.string()),
}

export const overridableFieldsValidator = v.object(overridableFields)

/**
 * Everything a user may patch on their own settings row.
 * Prompt, reminder, provider and MCP sets live in their own tables.
 */
export const settingsMutableFields = {
  displayName: v.optional(v.string()),
  allowInteractiveShells: v.optional(v.boolean()),
  desktopNotifications: v.optional(v.boolean()),
  titleModel: v.optional(v.string()),
  titleSystemPrompt: v.optional(v.string()),
  invertSend: v.optional(v.boolean()),
  groupBySender: v.optional(v.boolean()),
  followAgentThemeColor: v.optional(v.boolean()),
  avatarSize: v.optional(v.number()),
  webSearchInstances: v.optional(v.array(webSearchInstanceValidator)),
  uiFont: v.optional(v.string()),
  chatFont: v.optional(v.string()),
  monoFont: v.optional(v.string()),
  chatFontSize: v.optional(v.number()),
  ...overridableFields,
  themeMode: v.optional(themeValidator),
  recentModel: v.optional(v.string()),
  recentAgentId: v.optional(v.id('agents')),
  recentReasoning: v.optional(v.string()),
  recentWorkspaces: v.optional(v.array(v.string())),
}

export const settingsPatchArgsValidator = v.object(settingsMutableFields)

/**
 * The settings field that was requested to be cleared. Needed because Convex
 * drops `undefined` from a patch.
 */
export const settingsKeyValidator = v.union(
  ...(
    Object.keys(settingsMutableFields) as (keyof typeof settingsMutableFields)[]
  ).map((key) => v.literal(key)),
)

/** An owner’s shared application preferences. */
export const settingsSchema = v.object({
  ownerId: v.id('users'),
  avatarId: v.optional(v.id('avatars')),
  ...settingsMutableFields,
})

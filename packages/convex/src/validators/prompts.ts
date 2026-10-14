import { v } from 'convex/values'

import { roleValidator } from './messages'

/** Which set a prompt row belongs to. */
export const promptScopeValidator = v.union(
  v.literal('own'), // an agent's own prompts
  v.literal('library'), // referenced by id from `promptOrder`
  v.literal('compaction'),
  v.literal('impersonation'),
)

export const promptMessageValidator = v.object({
  role: roleValidator,
  content: v.string(),
})

export const promptValidator = v.object({
  id: v.string(),
  name: v.string(),
  role: roleValidator,
  content: v.string(),
  enabled: v.boolean(),
  visible: v.boolean(),
  starter: v.optional(v.boolean()),
})

export const promptMarkerTypeValidator = v.union(
  v.literal('message-history'),
  v.literal('system-boundary'),
)

export const promptMarkerValidator = v.object({
  type: promptMarkerTypeValidator,
})

export const promptItemValidator = v.union(
  promptValidator,
  promptMarkerValidator,
)

export const promptOrderRefValidator = v.object({
  kind: v.union(v.literal('own'), v.literal('library')),
  id: v.string(),
})

export const createPromptArgsValidator = v.object({
  scope: promptScopeValidator,
  agentId: v.optional(v.id('agents')),
  item: promptItemValidator,
  index: v.optional(v.number()),
})

export const updatePromptArgsValidator = v.object({
  promptId: v.id('prompts'),
  item: promptItemValidator,
})

export const reorderPromptsArgsValidator = v.object({
  scope: promptScopeValidator,
  agentId: v.optional(v.id('agents')),
  promptIds: v.array(v.id('prompts')),
})

export const replacePromptScopeArgsValidator = v.object({
  scope: promptScopeValidator,
  agentId: v.optional(v.id('agents')),
  items: v.array(promptItemValidator),
})

/** A prompt of any kind, kept in a separate table due to its unbounded nature. */
export const promptSchema = v.object({
  ownerId: v.id('users'),
  /** Absent if this prompt lives in the owner's settings. */
  agentId: v.optional(v.id('agents')),
  scope: promptScopeValidator,
  order: v.number(),
  /** Corresponds to the id for prompts, and the type for markers. */
  key: v.string(),
  item: promptItemValidator,
})

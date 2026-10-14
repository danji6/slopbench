import { v } from 'convex/values'

import { roleValidator } from './messages'

/** Which set a reminder row belongs to. */
export const reminderScopeValidator = v.union(
  v.literal('own'),
  v.literal('library'),
)

export const reminderPromptValidator = v.object({
  id: v.string(),
  name: v.string(),
  role: roleValidator,
  content: v.string(),
  enabled: v.boolean(),
  interval: v.number(), // injected as a hidden message every N steps
  eager: v.optional(v.boolean()), // fire on first sight instead of waiting a full interval
})

export const replaceReminderScopeArgsValidator = v.object({
  scope: reminderScopeValidator,
  agentId: v.optional(v.id('agents')),
  items: v.array(reminderPromptValidator),
})

export const createReminderArgsValidator = v.object({
  scope: reminderScopeValidator,
  agentId: v.optional(v.id('agents')),
  item: reminderPromptValidator,
})

export const updateReminderArgsValidator = v.object({
  reminderId: v.id('reminders'),
  item: reminderPromptValidator,
})

/** Similar to prompts, but injected at configured intervals. */
export const reminderSchema = v.object({
  ownerId: v.id('users'),
  /** Absent if this prompt lives in the owner's settings. */
  agentId: v.optional(v.id('agents')),
  scope: reminderScopeValidator,
  order: v.number(),
  key: v.string(),
  item: reminderPromptValidator,
})

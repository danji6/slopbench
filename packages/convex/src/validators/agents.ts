import { v } from 'convex/values'

import {
  promptItemValidator,
  promptOrderRefValidator,
  promptValidator,
} from './prompts'
import { reasoningEffortValidator } from './providers'
import { reminderPromptValidator } from './reminders'
import { overridableFields } from './settings'

/** Agent approvals merged into every session's approvals. */
export const agentAutoApproveValidator = v.object({
  paths: v.optional(v.array(v.string())),
  tools: v.optional(v.array(v.string())),
  shell: v.optional(v.array(v.string())),
})

export const agentSubagentOverrideValidator = v.object({
  agentId: v.id('agents'),
  modelId: v.optional(v.string()),
  reasoningEffort: v.optional(reasoningEffortValidator),
})

/** Which owned agents an agent may spawn as sub-agents. */
export const agentSubAgentsValidator = v.object({
  mode: v.union(v.literal('allow'), v.literal('deny')),
  agentIds: v.array(v.id('agents')),
  overrides: v.optional(v.array(agentSubagentOverrideValidator)),
})

export const agentMutableFieldsValidator = {
  description: v.optional(v.string()),
  tools: v.optional(v.array(v.string())),
  libraryReminderIds: v.optional(v.array(v.string())),
  promptOrder: v.optional(v.array(promptOrderRefValidator)),
  trimContext: v.optional(v.boolean()),
  contextWindow: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  shareUserDisplayNames: v.optional(v.boolean()),
  shareAgentDisplayNames: v.optional(v.boolean()),
  maskOtherAgents: v.optional(v.boolean()),
  autoApprove: v.optional(agentAutoApproveValidator),
  subAgents: v.optional(agentSubAgentsValidator),
  ...overridableFields,
}

export const createAgentArgsValidator = v.object({
  name: v.string(),
  prompts: v.optional(v.array(promptItemValidator)),
  reminderPrompts: v.optional(v.array(reminderPromptValidator)),
  compactionPrompts: v.optional(v.array(promptValidator)),
  impersonationPrompts: v.optional(v.array(promptValidator)),
  ...agentMutableFieldsValidator,
})

/**
 * The agent field that was requested to be cleared. Needed because Convex
 * drops `undefined` from a patch.
 */
export const agentKeyValidator = v.union(
  ...(
    Object.keys(
      agentMutableFieldsValidator,
    ) as (keyof typeof agentMutableFieldsValidator)[]
  ).map((key) => v.literal(key)),
)

export const updateAgentArgsValidator = v.object({
  agentId: v.id('agents'),
  name: v.optional(v.string()),
  /** Field names whose values should be cleared. */
  unset: v.optional(v.array(agentKeyValidator)),
  ...agentMutableFieldsValidator,
})

/** Shared ownership, path, revision, and operation lease for a personal folder. */
export const agentHomeSchema = v.object({
  ownerId: v.id('users'),
  originAgentId: v.id('agents'),
  managed: v.boolean(),
  path: v.optional(v.string()),
  revision: v.number(),
  operationId: v.optional(v.id('agentFileOperations')),
})

/** An agent’s settings and optional personal folder membership. */
export const agentSchema = v.object({
  /** Absent until a personal folder is explicitly assigned. */
  homeId: v.optional(v.id('agentHomes')),
  fileOperationId: v.optional(v.id('agentFileOperations')),
  ownerId: v.id('users'),
  name: v.string(),
  description: v.optional(v.string()),
  avatarId: v.optional(v.id('avatars')),
  promptOrder: v.optional(v.array(promptOrderRefValidator)),
  libraryReminderIds: v.optional(v.array(v.string())),
  /** Names of the selected tools. */
  tools: v.optional(v.array(v.string())),
  trimContext: v.optional(v.boolean()),
  /** Library skills omitted from this agent's catalog. */
  disabledSkillIds: v.optional(v.array(v.id('skills'))),
  contextWindow: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  shareUserDisplayNames: v.optional(v.boolean()),
  shareAgentDisplayNames: v.optional(v.boolean()),
  maskOtherAgents: v.optional(v.boolean()),
  autoApprove: v.optional(agentAutoApproveValidator),
  subAgents: v.optional(agentSubAgentsValidator),
  ...overridableFields,
})

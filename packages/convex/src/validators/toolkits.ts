import { v } from 'convex/values'

import {
  mcpLaunchFields,
  mcpToolMetaValidator,
  mcpTransportValidator,
} from './mcp'

export const toolkitSchema = v.object({
  ownerId: v.id('users'),
  root: v.string(),
  name: v.string(),
  version: v.optional(v.string()),
  revision: v.string(),
  manifest: v.string(),
  skillsEnabled: v.boolean(),
  disabledSkills: v.array(v.string()),
  status: v.union(
    v.literal('ready'),
    v.literal('changed'),
    v.literal('missing'),
  ),
  diagnostic: v.optional(v.string()),
})

export const toolkitIdValidator = v.object({
  toolkitId: v.id('toolkits'),
})

export const toolkitPublishValidator = v.object({
  subject: v.string(),
  toolkitId: v.optional(v.id('toolkits')),
  root: v.string(),
  revision: v.string(),
  manifest: v.string(),
  previousRevision: v.optional(v.string()),
  connections: v.array(
    v.object({
      name: v.string(),
      url: v.string(),
      transport: mcpTransportValidator,
      ...mcpLaunchFields,
    }),
  ),
})

export const toolkitSettingsValidator = v.object({
  ...toolkitIdValidator.fields,
  skillsEnabled: v.optional(v.boolean()),
  disabledSkills: v.optional(v.array(v.string())),
  skill: v.optional(v.object({ name: v.string(), enabled: v.boolean() })),
})

export const toolkitSelectionValidator = v.object({
  ...toolkitIdValidator.fields,
  agentId: v.id('agents'),
  enabled: v.boolean(),
})

export const toolkitListValidator = v.object({
  agentId: v.optional(v.id('agents')),
})

export const toolkitComponentValidator = v.object({
  tools: v.optional(v.array(mcpToolMetaValidator)),
  serverId: v.id('mcpServers'),
  enabled: v.boolean(),
  env: v.optional(v.record(v.string(), v.string())),
  secretEnv: v.optional(v.record(v.string(), v.string())),
  apiKey: v.optional(v.string()),
})

export const toolkitMissingValidator = v.object({
  ...toolkitIdValidator.fields,
  subject: v.string(),
  acceptedRevision: v.string(),
  diagnostic: v.string(),
})

export const toolkitSkillReadValidator = v.object({
  streamId: v.id('streams'),
  generation: v.number(),
  uri: v.string(),
  offset: v.number(),
  length: v.number(),
})

export const toolkitObservationValidator = v.object({
  acceptedRevision: v.string(),
  streamId: v.id('streams'),
  generation: v.number(),
  toolkitId: v.id('toolkits'),
  observedRevision: v.optional(v.string()),
  diagnostic: v.optional(v.string()),
})

export const toolkitSkillsValidator = v.object({
  ...toolkitIdValidator.fields,
  offset: v.number(),
  fingerprint: v.optional(v.string()),
})

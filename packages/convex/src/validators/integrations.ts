import { v } from 'convex/values'

import {
  mcpLaunchFields,
  mcpToolMetaValidator,
  mcpTransportValidator,
} from './mcp'

export const integrationSchema = v.object({
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

export const integrationIdValidator = v.object({
  integrationId: v.id('integrations'),
})

export const integrationPublishValidator = v.object({
  subject: v.string(),
  integrationId: v.optional(v.id('integrations')),
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

export const integrationSettingsValidator = v.object({
  ...integrationIdValidator.fields,
  skillsEnabled: v.optional(v.boolean()),
  disabledSkills: v.optional(v.array(v.string())),
  skill: v.optional(v.object({ name: v.string(), enabled: v.boolean() })),
})

export const integrationSelectionValidator = v.object({
  ...integrationIdValidator.fields,
  agentId: v.id('agents'),
  enabled: v.boolean(),
})

export const integrationListValidator = v.object({
  agentId: v.optional(v.id('agents')),
})

export const integrationComponentValidator = v.object({
  tools: v.optional(v.array(mcpToolMetaValidator)),
  serverId: v.id('mcpServers'),
  enabled: v.boolean(),
  env: v.optional(v.record(v.string(), v.string())),
  secretEnv: v.optional(v.record(v.string(), v.string())),
  apiKey: v.optional(v.string()),
})

export const integrationMissingValidator = v.object({
  ...integrationIdValidator.fields,
  subject: v.string(),
  acceptedRevision: v.string(),
  diagnostic: v.string(),
})

export const integrationSkillReadValidator = v.object({
  streamId: v.id('streams'),
  generation: v.number(),
  uri: v.string(),
  offset: v.number(),
  length: v.number(),
})

export const integrationObservationValidator = v.object({
  acceptedRevision: v.string(),
  streamId: v.id('streams'),
  generation: v.number(),
  integrationId: v.id('integrations'),
  observedRevision: v.optional(v.string()),
  diagnostic: v.optional(v.string()),
})

export const integrationSkillsValidator = v.object({
  ...integrationIdValidator.fields,
  offset: v.number(),
  fingerprint: v.optional(v.string()),
})

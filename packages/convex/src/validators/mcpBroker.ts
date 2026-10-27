import { v } from 'convex/values'

import { streamExecutionArgsValidator } from './streams'

export const mcpBrokerNameSchema = v.object({
  sessionId: v.id('sessions'),
  kind: v.union(v.literal('server'), v.literal('tool'), v.literal('output')),
  target: v.string(),
  name: v.string(),
  nextSuffix: v.optional(v.number()),
})

export const brokerServerValidator = v.object({
  ...streamExecutionArgsValidator.fields,
  server: v.string(),
})

export const brokerTargetValidator = v.object({
  ...streamExecutionArgsValidator.fields,
  tool: v.string(),
  forDefinition: v.optional(v.boolean()),
})

export const brokerSearchValidator = v.object({
  ...streamExecutionArgsValidator.fields,
  server: v.optional(v.string()),
  query: v.string(),
  cursor: v.optional(v.string()),
  limit: v.number(),
})

export const brokerOutputValidator = v.object({
  ...streamExecutionArgsValidator.fields,
  output: v.string(),
})

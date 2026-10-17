import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'

export const verifySkillIdsValidator = v.object({
  skillIds: v.array(v.id('skills')),
})

export const skillVerificationPageValidator = v.object({
  missing: v.array(v.object({ skillId: v.id('skills'), name: v.string() })),
  checked: v.number(),
  skipped: v.number(),
  isDone: v.boolean(),
  continueCursor: v.string(),
})

export const removeMissingSkillArgsValidator = v.object({
  skillId: v.id('skills'),
  ownerId: v.id('users'),
  importOperationId: v.optional(v.id('agentFileOperations')),
})

export const skillAssignmentsArgsValidator = v.object({
  agentId: v.id('agents'),
  paginationOpts: paginationOptsValidator,
  search: v.optional(v.string()),
})

export const prepareSkillImportArgsValidator = v.object({
  attempt: v.number(),
  operationId: v.id('agentFileOperations'),
  cursor: v.number(),
  metadata: v.object({ name: v.string(), description: v.string() }),
})

export const finishSkillImportArgsValidator = v.object({
  attempt: v.number(),
  operationId: v.id('agentFileOperations'),
  cursor: v.number(),
  nextCursor: v.number(),
  skillId: v.optional(v.id('skills')),
  outcome: v.union(
    v.literal('installed'),
    v.literal('skipped'),
    v.literal('failed'),
  ),
  message: v.optional(v.string()),
})

export const skillListArgsValidator = v.object({
  paginationOpts: paginationOptsValidator,
  search: v.optional(v.string()),
  agentId: v.optional(v.id('agents')),
  assignment: v.optional(v.union(v.literal('added'), v.literal('not-added'))),
})

export const continueSkillImportArgsValidator = v.object({
  operationId: v.id('agentFileOperations'),
  cursor: v.number(),
  attempt: v.number(),
})

/** An owner-bound upload ticket and its verified storage object. */
export const skillUploadSchema = v.object({
  ownerId: v.id('users'),
  storageId: v.optional(v.id('_storage')),
  ticket: v.string(),
  verified: v.boolean(),
})

export const skillSchema = v.object({
  ownerId: v.id('users'),
  name: v.string(),
  description: v.string(),
  status: v.union(
    v.literal('installing'),
    v.literal('ready'),
    v.literal('failed'),
  ),
  operationId: v.optional(v.id('agentFileOperations')),
  importOperationId: v.optional(v.id('agentFileOperations')),
})

export const agentSkillSchema = v.object({
  homeId: v.id('agentHomes'),
  ownerId: v.id('users'),
  skillId: v.id('skills'),
  name: v.string(),
  description: v.string(),
})

import { v } from 'convex/values'

export const agentFileKind = v.union(
  v.literal('ensure'),
  v.literal('detach'),
  v.literal('delete-home'),
  v.literal('install'),
  v.literal('assign'),
  v.literal('delete-assigned'),
  v.literal('delete-library'),
  v.literal('home'),
  v.literal('duplicate'),
)
export const fileOperationArgs = v.object({
  kind: agentFileKind,
  agentId: v.optional(v.id('agents')),
  skillId: v.optional(v.id('skills')),
  assignmentId: v.optional(v.id('agentSkills')),
  source: v.optional(v.string()),
  storageId: v.optional(v.id('_storage')),
  destination: v.optional(v.string()),
  copyFiles: v.optional(v.boolean()),
  removeFolder: v.optional(v.boolean()),
  duplicateId: v.optional(v.id('agents')),
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

export const agentFileOperationSchema = v.object({
  ...fileOperationArgs.fields,
  homeId: v.optional(v.id('agentHomes')),
  destinationHomeId: v.optional(v.id('agentHomes')),
  joinedHome: v.optional(v.boolean()),
  attempt: v.optional(v.number()),
  ownerId: v.id('users'),
  uploadTicket: v.optional(v.string()),
  finishingHome: v.optional(v.boolean()),
  previousHomePath: v.optional(v.string()),
  importCursor: v.optional(v.number()),
  importSummary: v.optional(
    v.object({
      installed: v.number(),
      skipped: v.number(),
      failed: v.number(),
    }),
  ),
  importError: v.optional(v.string()),
  status: v.union(
    v.literal('queued'),
    v.literal('running'),
    v.literal('done'),
    v.literal('failed'),
  ),
  error: v.optional(v.string()),
  updatedAt: v.number(),
})

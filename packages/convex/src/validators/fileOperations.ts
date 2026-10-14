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

export const ensureHomeArgsValidator = v.object({
  kind: v.literal('ensure'),
  agentId: v.id('agents'),
})

export const detachHomeArgsValidator = v.object({
  kind: v.literal('detach'),
  agentId: v.id('agents'),
  removeFolder: v.optional(v.boolean()),
})

export const deleteHomeArgsValidator = v.object({
  kind: v.literal('delete-home'),
})

export const installDirectoryArgsValidator = v.object({
  kind: v.literal('install'),
  source: v.string(),
})

export const installUploadArgsValidator = v.object({
  kind: v.literal('install'),
  storageId: v.id('_storage'),
})

export const assignSkillArgsValidator = v.object({
  kind: v.literal('assign'),
  agentId: v.id('agents'),
  skillId: v.id('skills'),
})

export const deleteAssignedSkillArgsValidator = v.object({
  kind: v.literal('delete-assigned'),
  agentId: v.id('agents'),
  assignmentId: v.id('agentSkills'),
})

export const deleteLibrarySkillArgsValidator = v.object({
  kind: v.literal('delete-library'),
  skillId: v.id('skills'),
})

export const changeHomeArgsValidator = v.object({
  kind: v.literal('home'),
  agentId: v.id('agents'),
  destination: v.string(),
  copyFiles: v.boolean(),
})

export const duplicateHomeArgsValidator = v.object({
  kind: v.literal('duplicate'),
  agentId: v.id('agents'),
  duplicateId: v.id('agents'),
})

export const fileOperationArgsValidator = v.union(
  ensureHomeArgsValidator,
  detachHomeArgsValidator,
  deleteHomeArgsValidator,
  installDirectoryArgsValidator,
  installUploadArgsValidator,
  assignSkillArgsValidator,
  deleteAssignedSkillArgsValidator,
  deleteLibrarySkillArgsValidator,
  changeHomeArgsValidator,
  duplicateHomeArgsValidator,
)

/** Keeps the command union inside the object required by Convex function arguments. */
export const startFileOperationArgsValidator = v.object({
  operation: fileOperationArgsValidator,
})

export const completeAgentFileArgsValidator = v.object({
  attempt: v.optional(v.number()),
  operationId: v.id('agentFileOperations'),
  path: v.optional(v.string()),
  previousPath: v.optional(v.string()),
})

export const invalidateAgentHomeArgsValidator = v.object({
  operationId: v.id('agentFileOperations'),
  cursor: v.union(v.string(), v.null()),
  previousPath: v.optional(v.string()),
})

export const failAgentFileArgsValidator = v.object({
  operationId: v.id('agentFileOperations'),
  message: v.string(),
  attempt: v.optional(v.number()),
})

export const reserveHomeArgsValidator = v.object({
  attempt: v.optional(v.number()),
  operationId: v.id('agentFileOperations'),
  path: v.string(),
  insideData: v.optional(v.boolean()),
})

export const copySkillAssignmentsArgsValidator = v.object({
  operationId: v.id('agentFileOperations'),
  ids: v.array(v.id('agentSkills')),
  attempt: v.optional(v.number()),
})

export const agentFileOperationSchema = v.object({
  // Persisted operations include prepared targets and progress beyond command args.
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

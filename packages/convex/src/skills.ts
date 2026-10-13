import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'

import { internalMutation, internalQuery } from './_generated/server'
import { authMutation, authQuery } from './functions'
import * as Completion from './model/skills/completion'
import * as Endpoints from './model/skills/endpoints'
import * as Homes from './model/skills/homes'
import * as Imports from './model/skills/imports'
import * as Library from './model/skills/library'
import * as Operations from './model/skills/operations'
import { cleanupRecords } from './model/skills/removal'
import * as Uploads from './model/skills/uploads'
import {
  completeAgentFileArgsValidator,
  continueSkillImportArgsValidator,
  copySkillAssignmentsArgsValidator,
  failAgentFileArgsValidator,
  finishSkillImportArgsValidator,
  invalidateAgentHomeArgsValidator,
  prepareSkillImportArgsValidator,
  reserveHomeArgsValidator,
  skillAssignmentsArgsValidator,
  skillListArgsValidator,
} from './validators/args'
import { fileOperationArgs } from './validators/skills'

export const list = authQuery({
  args: skillListArgsValidator.fields,
  handler: Library.list,
})

export const assigned = authQuery({
  args: { agentId: v.id('agents'), paginationOpts: paginationOptsValidator },
  handler: Library.assigned,
})

export const start = authMutation({
  args: fileOperationArgs.fields,
  handler: Endpoints.start,
})

export const retry = authMutation({
  args: { operationId: v.id('agentFileOperations') },
  handler: Operations.retry,
})

export const operation = authQuery({
  args: { operationId: v.id('agentFileOperations') },
  handler: Endpoints.operation,
})

export const generateUploadUrl = authMutation({
  args: {},
  handler: Uploads.generateUploadUrl,
})

export const recordUpload = authMutation({
  args: { uploadId: v.id('skillUploads'), storageId: v.id('_storage') },
  handler: Uploads.recordUpload,
})

export const _getUpload = internalQuery({
  args: {
    storageId: v.optional(v.id('_storage')),
    uploadId: v.optional(v.id('skillUploads')),
  },
  handler: Uploads.getUpload,
})

export const _verifyUpload = internalMutation({
  args: { uploadId: v.id('skillUploads') },
  handler: Uploads.verifyUpload,
})

export const _deleteUpload = internalMutation({
  args: { uploadId: v.id('skillUploads') },
  handler: Uploads.deleteUpload,
})

export const _getOperation = internalQuery({
  args: { operationId: v.id('agentFileOperations') },
  handler: Endpoints.getOperation,
})

export const _assignments = internalQuery({
  args: skillAssignmentsArgsValidator.fields,
  handler: Endpoints.assignments,
})

export const _agent = internalQuery({
  args: { agentId: v.id('agents') },
  handler: Endpoints.agent,
})

export const _complete = internalMutation({
  args: completeAgentFileArgsValidator.fields,
  handler: Completion.complete,
})

export const _fail = internalMutation({
  args: failAgentFileArgsValidator.fields,
  handler: Completion.fail,
})

export const _prepareImportSkill = internalMutation({
  args: prepareSkillImportArgsValidator.fields,
  handler: Imports.prepare,
})

export const _finishImportSkill = internalMutation({
  args: finishSkillImportArgsValidator.fields,
  handler: Imports.finish,
})

export const _continueImport = internalMutation({
  args: continueSkillImportArgsValidator.fields,
  handler: Imports.continueImport,
})

export const _running = internalMutation({
  args: { operationId: v.id('agentFileOperations') },
  handler: Operations.running,
})

export const _copyAssignments = internalMutation({
  args: copySkillAssignmentsArgsValidator.fields,
  handler: Endpoints.copyAssignments,
})

export const _watchdog = internalMutation({
  args: { operationId: v.id('agentFileOperations') },
  handler: Endpoints.watchdog,
})

export const getHome = authQuery({
  args: { agentId: v.id('agents') },
  handler: Homes.getHome,
})

export const _reserveDestination = internalMutation({
  args: reserveHomeArgsValidator.fields,
  handler: Endpoints.reserveDestination,
})

export const _invalidateHomeCaches = internalMutation({
  args: invalidateAgentHomeArgsValidator.fields,
  handler: Endpoints.invalidateHomeCaches,
})

export const _cleanupHomeRecords = internalMutation({
  args: { homeId: v.id('agentHomes') },
  handler: cleanupRecords,
})

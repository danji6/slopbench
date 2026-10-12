import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'

import { internal } from './_generated/api'
import { internalMutation, internalQuery } from './_generated/server'
import { error } from './errors'
import { authMutation, authQuery } from './functions'
import { generateId } from './lib/utils'
import { requireAdmin, requireOwnedAgent } from './model/skills/access'
import * as Completion from './model/skills/completion'
import { assertHomeDestination } from './model/skills/destinations'
import * as Imports from './model/skills/imports'
import { invalidateHomeCaches } from './model/skills/invalidation'
import * as Library from './model/skills/library'
import * as Operations from './model/skills/operations'
import {
  completeAgentFileArgsValidator,
  finishSkillImportArgsValidator,
  invalidateAgentHomeArgsValidator,
  prepareSkillImportArgsValidator,
  rememberAgentHomeArgsValidator,
  skillAssignmentsArgsValidator,
} from './validators/args'
import { fileOperationArgs } from './validators/skills'

export const list = authQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
  },
  handler: Library.list,
})

export const assigned = authQuery({
  args: { agentId: v.id('agents'), paginationOpts: paginationOptsValidator },
  handler: Library.assigned,
})

export const start = authMutation({
  args: fileOperationArgs.fields,
  handler: (ctx, args) => {
    if (args.kind === 'duplicate' || args.duplicateId) {
      error('Use the agent duplication command', 400)
    }
    return Operations.start(ctx, args)
  },
})

export const retry = authMutation({
  args: { operationId: v.id('agentFileOperations') },
  handler: Operations.retry,
})

export const operation = authQuery({
  args: { operationId: v.id('agentFileOperations') },
  handler: async (ctx, { operationId }) => {
    requireAdmin(ctx)
    const op = await ctx.db.get(operationId)
    return op?.ownerId === ctx.userId
      ? { status: op.status, error: op.error, summary: op.importSummary }
      : null
  },
})

export const generateUploadUrl = authMutation({
  args: {},
  handler: async (ctx) => {
    requireAdmin(ctx)
    const ticket = generateId()
    const uploadId = await ctx.db.insert('skillUploads', {
      ownerId: ctx.userId,
      ticket,
      verified: false,
    })
    await ctx.scheduler.runAfter(
      24 * 60 * 60_000,
      internal.actions.skills._expireUpload,
      { uploadId },
    )
    return { url: await ctx.storage.generateUploadUrl(), ticket, uploadId }
  },
})

export const recordUpload = authMutation({
  args: { uploadId: v.id('skillUploads'), storageId: v.id('_storage') },
  handler: async (ctx, args) => {
    requireAdmin(ctx)
    const upload = await ctx.db.get(args.uploadId)
    if (!upload || upload.ownerId !== ctx.userId || upload.storageId) {
      error('Upload not found', 404)
    }
    if (!(await ctx.storage.getMetadata(args.storageId))) {
      error('Upload not found', 404)
    }
    const existing = await ctx.db
      .query('skillUploads')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first()
    if (existing) {
      error('This storage blob is already claimed', 409)
    }
    await ctx.db.patch(upload._id, { storageId: args.storageId })
  },
})

export const _getUpload = internalQuery({
  args: {
    storageId: v.optional(v.id('_storage')),
    uploadId: v.optional(v.id('skillUploads')),
  },
  handler: (ctx, args) =>
    args.uploadId
      ? ctx.db.get(args.uploadId)
      : ctx.db
          .query('skillUploads')
          .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
          .unique(),
})

export const _verifyUpload = internalMutation({
  args: { uploadId: v.id('skillUploads') },
  handler: (ctx, { uploadId }) => ctx.db.patch(uploadId, { verified: true }),
})

export const _deleteUpload = internalMutation({
  args: { uploadId: v.id('skillUploads') },
  handler: async (ctx, { uploadId }) => {
    const upload = await ctx.db.get(uploadId)
    if (!upload) {
      return
    }
    if (upload.verified && upload.storageId) {
      await ctx.storage.delete(upload.storageId)
    }
    await ctx.db.delete(uploadId)
  },
})

export const _getOperation = internalQuery({
  args: { operationId: v.id('agentFileOperations') },
  handler: async (ctx, { operationId }) => {
    const operation = await ctx.db.get(operationId)
    if (!operation) {
      return null
    }
    return {
      operation,
      agent: operation.agentId ? await ctx.db.get(operation.agentId) : null,
      skill: operation.skillId ? await ctx.db.get(operation.skillId) : null,
    }
  },
})

export const _assignments = internalQuery({
  args: skillAssignmentsArgsValidator.fields,
  handler: (ctx, args) =>
    Library.assignmentPage(
      ctx,
      args.agentId,
      args.paginationOpts,
      args.search?.trim().toLowerCase(),
    ),
})

export const _agent = internalQuery({
  args: { agentId: v.id('agents') },
  handler: (ctx, { agentId }) => ctx.db.get(agentId),
})

export const _complete = internalMutation({
  args: completeAgentFileArgsValidator.fields,
  handler: Completion.complete,
})

export const _fail = internalMutation({
  args: { operationId: v.id('agentFileOperations'), message: v.string() },
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
  args: { operationId: v.id('agentFileOperations'), cursor: v.number() },
  handler: Imports.continueImport,
})

export const _running = internalMutation({
  args: { operationId: v.id('agentFileOperations') },
  handler: Operations.running,
})

export const _copyAssignments = internalMutation({
  args: {
    operationId: v.id('agentFileOperations'),
    ids: v.array(v.id('agentSkills')),
  },
  handler: async (ctx, { operationId, ids }) => {
    const op = await ctx.db.get(operationId)
    if (!op?.duplicateId || op.status !== 'running' || ids.length > 20) {
      error('Invalid duplication page', 409)
    }
    for (const id of ids) {
      const row = await ctx.db.get(id)
      if (!row || row.agentId !== op.agentId || row.ownerId !== op.ownerId) {
        error('Assignment changed during duplication', 409)
      }
      const exists = await ctx.db
        .query('agentSkills')
        .withIndex('by_agentId_skillId', (q) =>
          q.eq('agentId', op.duplicateId!).eq('skillId', row.skillId),
        )
        .first()
      if (!exists) {
        const { _id, _creationTime, ...fields } = row
        await ctx.db.insert('agentSkills', {
          ...fields,
          agentId: op.duplicateId,
        })
      }
    }
  },
})

export const _watchdog = internalMutation({
  args: { operationId: v.id('agentFileOperations') },
  handler: async (ctx, args) => {
    const op = await ctx.db.get(args.operationId)
    if (op?.finishingHome && op.status === 'running') {
      await ctx.scheduler.runAfter(0, internal.skills._invalidateHomeCaches, {
        operationId: op._id,
        cursor: null,
        previousPath: op.previousHomePath,
      })
      return
    }
    if (
      op &&
      ['queued', 'running'].includes(op.status) &&
      Date.now() - op.updatedAt >= 9 * 60_000
    ) {
      await Completion.fail(ctx, {
        ...args,
        message:
          'Filesystem operation interrupted. Retry to reconcile its saved progress.',
      })
    }
  },
})

export const getHome = authQuery({
  args: { agentId: v.id('agents') },
  handler: async (ctx, { agentId }) => {
    requireAdmin(ctx)
    const agent = await requireOwnedAgent(ctx, agentId, ctx.userId)
    return {
      path: agent.resolvedHomePath,
      customPath: agent.homePath,
      operationId: agent.fileOperationId,
    }
  },
})

export const _reserveDestination = internalMutation({
  args: { operationId: v.id('agentFileOperations'), path: v.string() },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId)
    if (!operation?.agentId || operation.status !== 'running') {
      error('Folder operation expired', 409)
    }
    await assertHomeDestination(ctx, operation.agentId, args.path)
    await ctx.db.patch(operation.agentId, { pendingHomePath: args.path })
  },
})

export const _removeAssignments = internalMutation({
  args: { agentId: v.id('agents') },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('agentSkills')
      .withIndex('by_agentId_name', (q) => q.eq('agentId', args.agentId))
      .take(100)
    for (const row of rows) await ctx.db.delete(row._id)
    if (rows.length === 100) {
      await ctx.scheduler.runAfter(0, internal.skills._removeAssignments, args)
    }
  },
})

export const _rememberHome = internalMutation({
  args: rememberAgentHomeArgsValidator.fields,
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId)
    if (
      agent &&
      !agent.fileOperationId &&
      (agent.homeRevision ?? 0) === args.revision &&
      agent.resolvedHomePath !== args.path
    ) {
      await ctx.db.patch(agent._id, {
        resolvedHomePath: args.path,
        homeRevision: agent.resolvedHomePath
          ? (agent.homeRevision ?? 0) + 1
          : agent.homeRevision,
      })
    }
  },
})

export const _invalidateHomeCaches = internalMutation({
  args: invalidateAgentHomeArgsValidator.fields,
  handler: async (ctx, args) => {
    await invalidateHomeCaches(ctx, args)
  },
})

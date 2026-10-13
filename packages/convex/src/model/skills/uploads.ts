import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import { generateId } from '../../lib/utils'
import { requireAdmin } from './access'

export const generateUploadUrl = async (ctx: AuthMutationCtx) => {
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
}

export const recordUpload = async (
  ctx: AuthMutationCtx,
  args: { uploadId: Id<'skillUploads'>; storageId: Id<'_storage'> },
) => {
  requireAdmin(ctx)

  const upload = await ctx.db.get(args.uploadId)
  if (!upload || upload.ownerId !== ctx.userId || upload.storageId)
    error('Upload not found', 404)

  if (!(await ctx.db.system.get('_storage', args.storageId)))
    error('Upload not found', 404)

  const existing = await ctx.db
    .query('skillUploads')
    .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
    .first()
  if (existing) error('This storage blob is already claimed', 409)

  await ctx.db.patch(upload._id, { storageId: args.storageId })
}

export const getUpload = (
  ctx: QueryCtx,
  args: { storageId?: Id<'_storage'>; uploadId?: Id<'skillUploads'> },
) =>
  args.uploadId
    ? ctx.db.get(args.uploadId)
    : ctx.db
        .query('skillUploads')
        .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
        .unique()

export const verifyUpload = (
  ctx: MutationCtx,
  { uploadId }: { uploadId: Id<'skillUploads'> },
) => ctx.db.patch(uploadId, { verified: true })

export const deleteUpload = async (
  ctx: MutationCtx,
  { uploadId }: { uploadId: Id<'skillUploads'> },
) => {
  const upload = await ctx.db.get(uploadId)
  if (!upload) return
  if (upload.verified && upload.storageId)
    await ctx.storage.delete(upload.storageId)
  await ctx.db.delete(uploadId)
}

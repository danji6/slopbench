import { discoveryFingerprint } from '@sb/core/discovery-fingerprint'
import type { DiscoveryConnection } from '@sb/core/model-discovery'

import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../../functions'
import type { PreviewDetailArgs, StorePreviewArgs } from '../../types'

export async function storePreview(ctx: MutationCtx, args: StorePreviewArgs) {
  const id = await ctx.db.insert('discoveryPreviews', {
    ownerId: args.ownerId,
    fingerprint: args.fingerprint,
    expiresAt: Date.now() + 30 * 60_000,
  })
  for (const [order, model] of args.models.entries())
    await ctx.db.insert('modelCatalog', { generation: id, order, model })
  await ctx.scheduler.runAfter(30 * 60_000, internal.providers._deletePreview, {
    previewId: id,
  })
  return id
}

export async function previewModels(
  ctx: AuthMutationCtx,
  previewId: Id<'discoveryPreviews'>,
  connection: DiscoveryConnection,
) {
  const preview = requireCurrentPreview(
    await ctx.db.get(previewId),
    ctx.userId,
    'Discovery preview expired. Refresh models again.',
  )
  if (preview.fingerprint !== (await discoveryFingerprint(connection))) {
    error('Connection changed. Refresh models before saving.', 409)
  }

  const rows = await ctx.db
    .query('modelCatalog')
    .withIndex('by_generation', (q) => q.eq('generation', previewId))
    .collect()

  return rows.sort((a, b) => a.order - b.order).map((row) => row.model)
}

export async function deletePreview(
  ctx: MutationCtx,
  { previewId }: { previewId: Id<'discoveryPreviews'> },
) {
  if (!(await ctx.db.get(previewId))) return

  const rows = await ctx.db
    .query('modelCatalog')
    .withIndex('by_generation', (q) => q.eq('generation', previewId))
    .take(200)

  for (const row of rows) await ctx.db.delete(row._id)

  if (rows.length === 200) {
    await ctx.scheduler.runAfter(0, internal.providers._deletePreview, {
      previewId,
    })
  } else if (await ctx.db.get(previewId)) {
    await ctx.db.delete(previewId)
  }
}

export async function catalog(
  ctx: AuthQueryCtx,
  { previewId }: { previewId: Id<'discoveryPreviews'> },
) {
  const preview = await ctx.db.get(previewId)
  if (!ownsPreview(preview, ctx.userId)) return null
  if (preview.expiresAt < Date.now()) return null

  const rows = await ctx.db
    .query('modelCatalog')
    .withIndex('by_generation', (q) => q.eq('generation', previewId))
    .collect()

  return {
    models: rows.sort((a, b) => a.order - b.order).map((row) => row.model),
  }
}

export async function enrich(ctx: MutationCtx, args: PreviewDetailArgs) {
  requireCurrentPreview(
    await ctx.db.get(args.previewId),
    args.ownerId,
    'Discovery preview expired or connection changed. Refresh models again.',
    args.fingerprint,
  )

  const rows = await ctx.db
    .query('modelCatalog')
    .withIndex('by_generation', (q) => q.eq('generation', args.previewId))
    .collect()
  const row = rows.find((row) => row.model.id === args.model.id)
  if (!row || row.model.detailKey !== args.model.detailKey)
    error('Model details changed. Refresh models again.', 409)

  await ctx.db.patch(row._id, { model: args.model })
}

/** Checks ownership before reading preview lifecycle or connection details. */
function ownsPreview(
  preview: Doc<'discoveryPreviews'> | null,
  ownerId: Id<'users'>,
): preview is Doc<'discoveryPreviews'> {
  return !!preview && preview.ownerId === ownerId
}

function requireCurrentPreview(
  preview: Doc<'discoveryPreviews'> | null,
  ownerId: Id<'users'>,
  message: string,
  fingerprint?: string,
) {
  if (!ownsPreview(preview, ownerId)) error(message, 409)
  if (fingerprint !== undefined && preview.fingerprint !== fingerprint) {
    error(message, 409)
  }
  if (preview.expiresAt < Date.now()) error(message, 409)
  return preview
}

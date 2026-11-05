import { validateToolkitManifest } from '@sb/core/types/toolkit'
import type { ToolkitManifest } from '@sb/core/types/toolkit'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { ToolkitPublishArgs } from '../../types'
import { toolkitActor } from './access'
import { assertConfigurationCapacity } from './capacity'
import { publishComponents } from './components'

/** Publishes a validated snapshot and replaces affected runtime configurations. */
export async function publish(ctx: MutationCtx, args: ToolkitPublishArgs) {
  const actor = await toolkitActor(ctx, args.subject)
  const manifest = validateToolkitManifest(JSON.parse(args.manifest))

  const row = args.toolkitId
    ? await ctx.db.get(args.toolkitId)
    : await ctx.db
        .query('toolkits')
        .withIndex('by_ownerId_root', (q) =>
          q.eq('ownerId', actor._id).eq('root', args.root),
        )
        .unique()
  assertPublicationTarget(row, args, actor._id)

  const revisionChanged = row?.revision !== args.revision
  const id = await saveToolkit(ctx, row, args, actor._id, manifest)
  if (!row || revisionChanged) await publishComponents(ctx, id, args)
  await assertConfigurationCapacity(ctx, actor._id)

  return id
}

function assertPublicationTarget(
  row: Doc<'toolkits'> | null,
  args: ToolkitPublishArgs,
  ownerId: Id<'users'>,
) {
  if (args.toolkitId && !row) error('Toolkit was removed during refresh', 409)

  const refreshSuperseded =
    args.previousRevision !== undefined &&
    row?.revision !== args.previousRevision
  if (refreshSuperseded) {
    error('Toolkit revision changed during refresh', 409)
  }

  if (row && row.ownerId !== ownerId) {
    error('Toolkit not found', 404)
  }
  if (row && row.root !== args.root) {
    error('Linked root changed', 409)
  }
}

async function saveToolkit(
  ctx: MutationCtx,
  row: Doc<'toolkits'> | null,
  args: ToolkitPublishArgs,
  ownerId: Id<'users'>,
  manifest: ToolkitManifest,
) {
  const fields = {
    root: args.root,
    name: manifest.name ?? row?.name ?? args.root.split('/').at(-1)!,
    version: manifest.version,
    revision: args.revision,
    manifest: args.manifest,
    status: 'ready' as const,
    diagnostic: undefined,
  }
  if (row) {
    await ctx.db.patch(row._id, fields)
    return row._id
  }
  return ctx.db.insert('toolkits', {
    ...fields,
    ownerId,
    root: args.root,
    skillsEnabled: true,
    disabledSkills: [],
  })
}

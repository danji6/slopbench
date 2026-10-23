import { validateIntegrationManifest } from '@sb/core/types/integration'
import type { IntegrationManifest } from '@sb/core/types/integration'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { IntegrationPublishArgs } from '../../types'
import { integrationActor } from './access'
import { assertConfigurationCapacity } from './capacity'
import { publishComponents } from './components'

/** Publishes a validated snapshot and replaces affected runtime configurations. */
export async function publish(ctx: MutationCtx, args: IntegrationPublishArgs) {
  const actor = await integrationActor(ctx, args.subject)
  const manifest = validateIntegrationManifest(JSON.parse(args.manifest))

  const row = args.integrationId
    ? await ctx.db.get(args.integrationId)
    : await ctx.db
        .query('integrations')
        .withIndex('by_ownerId_root', (q) =>
          q.eq('ownerId', actor._id).eq('root', args.root),
        )
        .unique()
  assertPublicationTarget(row, args, actor._id)

  const revisionChanged = row?.revision !== args.revision
  const id = await saveIntegration(ctx, row, args, actor._id, manifest)
  if (!row || revisionChanged) await publishComponents(ctx, id, args)
  await assertConfigurationCapacity(ctx, actor._id)

  return id
}

function assertPublicationTarget(
  row: Doc<'integrations'> | null,
  args: IntegrationPublishArgs,
  ownerId: Id<'users'>,
) {
  if (args.integrationId && !row)
    error('Integration was removed during refresh', 409)
  const refreshSuperseded =
    args.previousRevision !== undefined &&
    row?.revision !== args.previousRevision
  if (refreshSuperseded)
    error('Integration revision changed during refresh', 409)
  if (row && row.ownerId !== ownerId) error('Integration not found', 404)
  if (row && row.root !== args.root) error('Linked root changed', 409)
}

async function saveIntegration(
  ctx: MutationCtx,
  row: Doc<'integrations'> | null,
  args: IntegrationPublishArgs,
  ownerId: Id<'users'>,
  manifest: IntegrationManifest,
) {
  const fields = {
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
  return ctx.db.insert('integrations', {
    ...fields,
    ownerId,
    root: args.root,
    skillsEnabled: true,
    disabledSkills: [],
  })
}

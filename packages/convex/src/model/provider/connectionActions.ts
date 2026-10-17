import type { DiscoveredModel } from '@sb/core/model-discovery'

import { api, internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { error } from '../../errors'
import type {
  DetailTargetsArgs,
  ModelProviderConfig,
  PreviewDiscoveryArgs,
  PreviewModelDetailsArgs,
  RemovedConnectionArgs,
} from '../../types'
import type { AccountStatus } from './openai/account'

export type DiscoveryResult = { attemptId?: string; error?: string }
type ChatGPTStatus = AccountStatus
type ConnectionArgs = { providerId: Id<'modelProviders'> }
type DiscoverArgs = ConnectionArgs & { force?: boolean }
type ModelDetailsArgs = ConnectionArgs & { modelId: string }

export async function discover(
  ctx: ActionCtx,
  { providerId, force }: DiscoverArgs,
): Promise<DiscoveryResult> {
  const connection = await ownedConnection(ctx, providerId)
  if (!connection.enabled && !force) return {}

  const { accountAdapter } = await import('./accounts')
  const account = accountAdapter(connection)

  if (account) {
    const status = await account.status(connection).catch(() => null)
    if (!status)
      return force
        ? {
            error: 'Model discovery failed. Check that the sidecar is running.',
          }
        : {}
    if (status.status !== 'connected' || !status.planEnabled) return {}
  }

  const run = {
    providerId,
    ownerId: connection.ownerId as Id<'users'>,
    revision: connection.configRevision ?? 0,
    generation: crypto.randomUUID(),
  }

  const started = await ctx.runMutation(internal.providers._beginDiscovery, {
    ...run,
    force: force ?? false,
  })
  if (!started) return {}

  const { discoverModels, DiscoveryError } = await import('./discovery')

  try {
    const cached = await ctx.runQuery(api.providers.catalog, { providerId })

    let models = await discoverModels(
      connection,
      account?.modelsFetch(connection),
    )
    models = models.map((model) => {
      const previous = cached.models.find((row) => row.id === model.id)
      const unchanged =
        previous?.detailsLoaded &&
        previous.detailKey &&
        previous.detailKey === model.detailKey
      return unchanged ? { ...previous, ...model } : model
    })

    for (let offset = 0; offset < models.length; offset += 100) {
      await ctx.runMutation(internal.providers._stageDiscovery, {
        ...run,
        models: models.slice(offset, offset + 100),
        offset,
      })
    }

    await ctx.runMutation(internal.providers._finishDiscovery, run)

    const { providerFeatures } = await import('@sb/core/provider-registry')
    if (providerFeatures(connection.id, connection.auth).modelDetails) {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.providerConnections._refreshDetails,
        { ...run, modelIds: connection.models.map((model) => model.id) },
      )
    }

    return { attemptId: run.generation }
  } catch (cause) {
    const message =
      'Model discovery failed. Check credentials, sign-in, and the provider URL, then refresh again.'
    const failure = cause instanceof DiscoveryError ? cause : undefined

    await ctx.runMutation(internal.providers._finishDiscovery, {
      ...run,
      failure: message,
      retryAfter: failure?.retryAfter,
      blocked: failure?.status === 401 || failure?.status === 403,
    })

    return { attemptId: run.generation, error: message }
  } finally {
    await ctx.runMutation(internal.providers._cleanupCatalog, { providerId })
  }
}

export async function preview(
  ctx: ActionCtx,
  args: PreviewDiscoveryArgs,
): Promise<{
  previewId: Id<'discoveryPreviews'>
  models: DiscoveredModel[]
}> {
  const ownerId = await authenticatedOwner(ctx)

  const saved = args.providerId
    ? await ownedConnection(ctx, args.providerId)
    : undefined
  if (
    saved &&
    (saved.id !== args.key || saved.auth !== (args.auth ?? 'apiKey'))
  ) {
    error('Connection type changed', 400)
  }

  const { providerFeatures } = await import('@sb/core/provider-registry')
  if (providerFeatures(args.key, args.auth).accountSignIn)
    error('Use the saved account catalog', 400)

  const connection = {
    ...args,
    id: args.key,
    apiKey: args.apiKey ?? saved?.apiKey,
  }

  const { discoverModels } = await import('./discovery')
  const { discoveryFingerprint } = await import('@sb/core/discovery-fingerprint') // prettier-ignore

  try {
    const models = await discoverModels(connection)
    const previewId = await ctx.runMutation(internal.providers._storePreview, {
      ownerId,
      fingerprint: await discoveryFingerprint(connection),
      models,
    })
    return { previewId, models }
  } catch {
    error(
      'Model discovery failed. Check the connection settings and retry.',
      400,
    )
  }
}

export async function status(
  ctx: ActionCtx,
  { providerId }: ConnectionArgs,
): Promise<ChatGPTStatus> {
  const { connection, adapter } = await ownedAccount(ctx, providerId)
  return adapter.status(connection)
}

export async function signIn(
  ctx: ActionCtx,
  { providerId }: ConnectionArgs,
): Promise<{ url: string; expiresAt: number }> {
  const { connection, adapter } = await ownedAccount(ctx, providerId)
  await ctx.runMutation(internal.providers._resetDiscovery, { providerId })
  return adapter.start(connection)
}

export async function disconnect(
  ctx: ActionCtx,
  { providerId }: ConnectionArgs,
): Promise<{ revoked: boolean }> {
  const { connection, adapter } = await ownedAccount(ctx, providerId)
  const result = await adapter.disconnect(connection)
  await ctx.runMutation(internal.providers._resetDiscovery, { providerId })
  return result
}

export async function cancelSignIn(
  ctx: ActionCtx,
  { providerId }: ConnectionArgs,
): Promise<void> {
  const { connection, adapter } = await ownedAccount(ctx, providerId)
  await adapter.cancel(connection)
}

export async function remoteSetup(
  ctx: ActionCtx,
  { providerId }: ConnectionArgs,
): Promise<string> {
  const { connection, adapter } = await ownedAccount(ctx, providerId)
  return adapter.setup(connection)
}

export async function _disconnectRemoved(
  _ctx: ActionCtx,
  args: RemovedConnectionArgs,
): Promise<void> {
  const { accountAdapter } = await import('./accounts')
  const connection = { ...args, id: args.key, enabled: false, models: [] }
  await accountAdapter(connection)?.disconnect(connection)
}

async function authenticatedOwner(ctx: ActionCtx): Promise<Id<'users'>> {
  // This authenticated query also enforces the application's session policy
  return ctx.runQuery(api.providers.owner, {})
}

async function ownedConnection(
  ctx: ActionCtx,
  providerId: Id<'modelProviders'>,
): Promise<ModelProviderConfig> {
  const view = await ctx.runQuery(api.providers.get, { providerId })
  const connection = await ctx.runQuery(internal.providers._connection, {
    providerId,
    ownerId: view.ownerId,
  })
  if (!connection) error('Connection no longer exists', 404)
  return connection
}

async function ownedAccount(ctx: ActionCtx, providerId: Id<'modelProviders'>) {
  const connection = await ownedConnection(ctx, providerId)
  const { accountAdapter } = await import('./accounts')
  const adapter = accountAdapter(connection)
  if (!adapter) error('Connection does not support account sign-in', 400)
  return { connection, adapter }
}

export async function details(
  ctx: ActionCtx,
  { providerId, modelId }: ModelDetailsArgs,
): Promise<DiscoveredModel | null> {
  const connection = await ownedConnection(ctx, providerId)

  const catalog = await ctx.runQuery(api.providers.catalog, { providerId })
  const model = catalog.models.find((row) => row.id === modelId)
  if (!model || !catalog.generation) return null

  const { fetchModelDetails } = await import('./modelDetails')
  const result = await fetchModelDetails(connection, model)

  await ctx.runMutation(internal.providers._enrichModel, {
    providerId,
    ownerId: connection.ownerId as Id<'users'>,
    revision: catalog.revision,
    generation: catalog.generation,
    model: result,
  })

  return result
}

export async function previewDetails(
  ctx: ActionCtx,
  args: PreviewModelDetailsArgs,
): Promise<DiscoveredModel | null> {
  const ownerId = await authenticatedOwner(ctx)

  const saved = args.providerId
    ? await ownedConnection(ctx, args.providerId)
    : undefined
  const catalog = await ctx.runQuery(api.providers.previewCatalog, {
    previewId: args.previewId,
  })
  const model = catalog?.models.find((row) => row.id === args.modelId)
  if (!model) return null

  const connection = {
    ...args,
    id: args.key,
    apiKey: args.apiKey ?? saved?.apiKey,
  }

  const { fetchModelDetails } = await import('./modelDetails')
  const { discoveryFingerprint } = await import('@sb/core/discovery-fingerprint') // prettier-ignore
  const result = await fetchModelDetails(connection, model)

  await ctx.runMutation(internal.providers._enrichPreview, {
    previewId: args.previewId,
    ownerId,
    fingerprint: await discoveryFingerprint(connection),
    model: result,
  })

  return result
}

/** Enriches at most two configured models per scheduled action after publication. */
export async function refreshDetails(
  ctx: ActionCtx,
  args: DetailTargetsArgs,
): Promise<void> {
  const { modelIds, ...run } = args
  if (!modelIds.length) return

  const targets = await ctx.runQuery(internal.providers._detailTargets, {
    ...run,
    modelIds: modelIds.slice(0, 2),
  })
  const connection = await ctx.runQuery(internal.providers._connection, {
    providerId: run.providerId,
    ownerId: run.ownerId,
  })
  if (!connection) return

  const { fetchModelDetails } = await import('./modelDetails')

  await Promise.all(
    targets.map(async (model) => {
      try {
        const enriched = await fetchModelDetails(connection, model)
        await ctx.runMutation(internal.providers._enrichModel, {
          ...run,
          model: enriched,
        })
      } catch {
        // Optional detail failures leave the complete catalog usable
      }
    }),
  )

  if (modelIds.length > 2) {
    await ctx.scheduler.runAfter(
      0,
      internal.actions.providerConnections._refreshDetails,
      { ...run, modelIds: modelIds.slice(2) },
    )
  }
}

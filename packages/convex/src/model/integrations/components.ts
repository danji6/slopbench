import { mcpLaunchSchema } from '@sb/core/types/mcp'

import type { Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import type {
  IntegrationComponentArgs,
  IntegrationPublishArgs,
} from '../../types'
import { removeServer, writeTools } from '../mcp'
import { saveCredentials } from '../mcpConfiguration'
import { revokeRestrictedTargets } from '../mcpPolicyRevocation'
import { isAuthorized, retire, revoke } from '../mcpRuntime'
import { ownedIntegration } from './access'
import { assertConfigurationCapacity } from './capacity'

export function componentRows(
  ctx: QueryCtx,
  integrationId: Id<'integrations'>,
) {
  return ctx.db
    .query('mcpServers')
    .withIndex('by_integrationId', (q) => q.eq('integrationId', integrationId))
    .collect()
}

/** Publishes validated launch definitions while retaining independent user settings. */
export async function publishComponents(
  ctx: MutationCtx,
  id: Id<'integrations'>,
  args: IntegrationPublishArgs,
) {
  const integration = (await ctx.db.get(id))!
  const existing = await componentRows(ctx, id)

  for (const connection of args.connections) {
    const previous = existing.find(
      (row) => row.componentName === connection.name,
    )
    const { name, ...launch } = connection
    const fields = {
      ...launch,
      ownerId: integration.ownerId,
      integrationId: id,
      componentName: name,
      key: `${id}:${name}`,
      label: `${integration.name}: ${name}`,
      enabled: previous?.enabled ?? true,
      brokerEnabled: true,
      revision: (previous?.revision ?? 0) + 1,
      order: previous?.order ?? 0,
      integrationBinding: { root: args.root, revision: args.revision },
    }
    if (previous) {
      await revoke(
        ctx,
        { ownerId: integration.ownerId, serverKey: previous.key },
        'Integration revision replaced',
      )
      await ctx.db.patch(previous._id, fields)
    } else await ctx.db.insert('mcpServers', fields)
  }

  const auth = {
    ...ctx,
    userId: integration.ownerId,
    role: 'admin' as const,
    subject: '',
  }

  for (const row of existing) {
    const componentRemoved = !args.connections.some(
      (connection) => connection.name === row.componentName,
    )
    if (componentRemoved) await removeServer(auth, row)
  }
}

/** Retires only connections whose live authority was narrowed by the change. */
export async function reconcileIntegration(
  ctx: MutationCtx,
  id: Id<'integrations'>,
) {
  const rows = await componentRows(ctx, id)
  for (const server of rows) {
    const runtimes = await ctx.db
      .query('mcpRuntimes')
      .withIndex('by_ownerId_serverKey', (q) =>
        q.eq('ownerId', server.ownerId).eq('serverKey', server.key),
      )
      .collect()
    for (const runtime of runtimes) {
      if (runtime.state === 'disconnected') continue
      if (!(await isAuthorized(ctx, runtime)))
        await retire(ctx, runtime, 'Integration access revoked')
    }
  }
}

export async function configureComponent(
  ctx: AuthMutationCtx,
  args: IntegrationComponentArgs,
) {
  const row = await ctx.db.get(args.serverId)
  if (!row?.integrationId) error('Integration component not found', 404)

  await ownedIntegration(ctx, row.integrationId)
  const env =
    args.env === undefined ? row.env : mcpLaunchSchema.shape.env.parse(args.env)

  const launchChanged =
    JSON.stringify(env) !== JSON.stringify(row.env) ||
    args.apiKey !== undefined ||
    args.secretEnv !== undefined
  if (launchChanged) {
    await revoke(
      ctx,
      { ownerId: row.ownerId, serverKey: row.key },
      'Integration component settings changed',
    )
  }

  await ctx.db.patch(row._id, {
    enabled: args.enabled,
    env,
    revision: (row.revision ?? 0) + (launchChanged ? 1 : 0),
  })

  if (args.tools) await saveComponentPolicies(ctx, row._id, args.tools)
  await assertConfigurationCapacity(ctx, row.ownerId)
  await revokeRestrictedTargets(ctx, row.ownerId, row.key)
  await reconcileIntegration(ctx, row.integrationId)

  if (args.secretEnv !== undefined)
    mcpLaunchSchema.shape.secretEnv.parse(args.secretEnv)

  await saveCredentials(ctx, row.key, args.apiKey, args.secretEnv)
}

async function saveComponentPolicies(
  ctx: AuthMutationCtx,
  serverId: Id<'mcpServers'>,
  tools: NonNullable<IntegrationComponentArgs['tools']>,
) {
  const policies = tools.map(
    ({
      name,
      enabled,
      allowInReadOnly,
      nameOverride,
      descriptionOverride,
    }) => ({
      name,
      enabled,
      allowInReadOnly,
      nameOverride,
      descriptionOverride,
    }),
  )
  if (JSON.stringify(policies).length > 64 * 1024)
    error('Integration tool overrides exceed 64 KiB', 413)
  await writeTools(ctx, serverId, policies)
}

import { integrationWorkspaceSettings } from '@sb/core/types/integration'

import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { error } from '../errors'
import * as Credentials from './credentials'
import { launchFields, parseSecrets } from './mcpConfiguration'

/** Resolves private launch configuration only after the caller authorizes this server. */
export async function launchConnection(
  ctx: QueryCtx,
  server: Doc<'mcpServers'>,
  options: { allowWorkspaceTemplate?: boolean } = {},
) {
  if (server.integrationId) {
    const integration = await ctx.db.get(server.integrationId)
    if (!integration || integration.status !== 'ready')
      error('Integration is unavailable or needs a refresh', 409)
    if (!options.allowWorkspaceTemplate)
      integrationWorkspaceSettings(launchFields(server))
  }
  const secret = await Credentials.get(
    ctx,
    server.ownerId,
    'mcp-env',
    server.key,
  )
  return {
    ...launchFields(server),
    transport: server.transport,
    apiKey: await Credentials.get(ctx, server.ownerId, 'mcp', server.key),
    secretEnv: parseSecrets(secret),
  }
}

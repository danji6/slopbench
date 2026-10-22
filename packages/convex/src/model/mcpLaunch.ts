import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import * as Credentials from './credentials'
import { launchFields, parseSecrets } from './mcp'

/** Resolves private launch configuration only after the caller authorizes this server. */
export async function launchConnection(
  ctx: QueryCtx,
  server: Doc<'mcpServers'>,
) {
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

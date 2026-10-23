import type { McpRuntimeScope } from '@sb/core/types'
import type { McpServer } from '@sb/core/types'
import { mcpConnectionSchema } from '@sb/core/types'

import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { error } from '../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../functions'
import { minRole } from '../lib/roles'
import type {
  McpRuntimeArgs,
  McpRuntimeConnectedArgs,
  McpRuntimeControlArgs,
  McpRuntimeListArgs,
  McpRuntimePageArgs,
  McpRuntimeRetireArgs,
  McpRuntimeStatusArgs,
} from '../types'
import { resolve } from './mcp'
import { cancelForRuntime } from './mcpOperations'
import { isMcpServerSelected } from './mcpToolPolicy'
import { getSessionWithWorkspace, workspaceKey } from './session/folderContext'
import { getMembership } from './session/memberships'

type Runtime = Doc<'mcpRuntimes'>

type Selector = {
  ownerId?: Id<'users'>
  sessionId?: Id<'sessions'>
  agentId?: Id<'agents'>
  serverKey?: string
}

export function runtimeScope(row: Runtime): McpRuntimeScope {
  return {
    epoch: row.epoch ?? 0,
    key: row.key,
    ownerId: row.ownerId,
    sessionId: row.sessionId,
    agentId: row.agentId,
    serverId: row.serverKey,
    revision: row.revision,
  }
}

/** Journals teardown in the same transaction that revokes configuration. */
export async function retire(ctx: MutationCtx, row: Runtime, reason: string) {
  await cancelForRuntime(ctx, row._id, reason)
  await ctx.db.patch(row._id, {
    state: 'disconnected',
    reason,
    updatedAt: Date.now(),
  })
  const cleanupId = await ctx.db.insert('mcpCleanups', {
    scope: runtimeScope(row),
  })
  await ctx.scheduler.runAfter(0, internal.actions.mcp._cleanup, { cleanupId })
}

export async function revoke(
  ctx: MutationCtx,
  selector: Selector,
  reason: string,
) {
  const rows = await rowsForSelector(ctx, selector)
  for (const row of rows) {
    if (selector.serverKey && row.serverKey !== selector.serverKey) continue
    if (row.state !== 'disconnected') await retire(ctx, row, reason)
  }
}

function rowsForSelector(ctx: QueryCtx, selector: Selector) {
  if (selector.sessionId) {
    return ctx.db
      .query('mcpRuntimes')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', selector.sessionId!))
      .collect()
  }
  if (selector.agentId) {
    return ctx.db
      .query('mcpRuntimes')
      .withIndex('by_agentId', (q) => q.eq('agentId', selector.agentId!))
      .collect()
  }
  return ctx.db
    .query('mcpRuntimes')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', selector.ownerId!))
    .collect()
}

type RuntimeInput = {
  ownerId: Id<'users'>
  sessionId: Id<'sessions'>
  agentId: Id<'agents'>
  invokedBy: Id<'users'>
  serverKey: string
  revision: number
}

/** Creates a session-local identity before any process is launched. */
export async function authorizeRuntime(ctx: MutationCtx, input: RuntimeInput) {
  const session = await getSessionWithWorkspace(ctx, input.sessionId)
  if (!session) error('Workspace is unavailable or changing', 409)
  const workspaceUnavailable = session.contextLock || session.settings?.disabled
  if (workspaceUnavailable) {
    error('Workspace is unavailable or changing', 409)
  }
  if (!(await hasInvocationAccess(ctx, input.sessionId, input.invokedBy))) {
    error('Session access revoked', 403)
  }

  const row = await ensureRuntime(ctx, input, workspaceKey(session.workspace))
  if (row.state === 'disconnected' || row.state === 'lost') {
    error(
      'MCP session is disconnected or lost; reconnect it in MCP settings',
      409,
    )
  }

  if (row.invokedBy !== input.invokedBy) {
    await ctx.db.patch(row._id, { invokedBy: input.invokedBy })
  }

  return {
    runtimeId: row._id,
    scope: runtimeScope(row),
    bootId: row.bootId,
    generation: row.generation,
    expiresAt: Date.now() + 30_000,
  }
}

async function ensureRuntime(
  ctx: MutationCtx,
  input: RuntimeInput,
  authority: string,
): Promise<Runtime> {
  const row = await ctx.db
    .query('mcpRuntimes')
    .withIndex('by_sessionId_agentId_serverKey', (q) =>
      q
        .eq('sessionId', input.sessionId)
        .eq('agentId', input.agentId)
        .eq('serverKey', input.serverKey),
    )
    .unique()

  const sameConfiguration =
    row?.revision === String(input.revision) && row.workspaceKey === authority
  if (row && sameConfiguration) {
    return row
  }

  const fields = runtimeFields(input, authority, row)
  if (row) {
    await retire(ctx, row, 'MCP configuration or workspace changed')
    await ctx.db.replace(row._id, fields)
    return (await ctx.db.get(row._id))!
  }

  const id = await ctx.db.insert('mcpRuntimes', fields)
  // The transaction publishes the database identity and epoch together
  await ctx.db.patch(id, { key: `${id}:${fields.epoch}` })
  return (await ctx.db.get(id))!
}

function runtimeFields(
  input: RuntimeInput,
  authority: string,
  row: Runtime | null,
) {
  const epoch = (row?.epoch ?? 0) + 1
  return {
    ...input,
    revision: String(input.revision),
    workspaceKey: authority,
    epoch,
    key: row ? `${row._id}:${epoch}` : '',
    state: 'connecting',
    updatedAt: Date.now(),
  }
}

export async function connected(
  ctx: MutationCtx,
  args: McpRuntimeConnectedArgs,
) {
  const row = await ctx.db.get(args.runtimeId)
  if (!matchesCurrentRuntime(row, args.key)) return false
  if (!(await isAuthorized(ctx, row))) return false
  const initialization = args.initialization ?? row.initialization
  const connectionRecorded =
    row.state === 'connected' &&
    row.bootId === args.bootId &&
    row.generation === args.generation &&
    row.initialization === initialization
  if (connectionRecorded) return true

  await ctx.db.patch(row._id, {
    state: 'connected',
    bootId: args.bootId,
    generation: args.generation,
    initialization,
    updatedAt: Date.now(),
  })

  return true
}

/** Rechecks current access for periodic reconciliation, independently of a turn. */
export async function isAuthorized(
  ctx: QueryCtx,
  row: Runtime,
): Promise<boolean> {
  const [agent, invoker, session] = await Promise.all([
    ctx.db.get(row.agentId),
    ctx.db.get(row.invokedBy),
    getSessionWithWorkspace(ctx, row.sessionId),
  ])
  if (!agent || !invoker || !session) return false

  const sessionUnavailable = session.settings?.disabled || session.contextLock
  if (sessionUnavailable) return false
  if (agent.ownerId !== row.ownerId) return false
  if (workspaceKey(session.workspace) !== row.workspaceKey) return false
  if (!(await hasInvocationAccess(ctx, row.sessionId, row.invokedBy))) return false // prettier-ignore

  const servers = await resolve(ctx, row.ownerId, {
    agentId: row.agentId,
    sessionId: row.sessionId,
  })
  const server = servers.find((server) => server.id === row.serverKey && server.enabled) // prettier-ignore
  if (!server) return false
  if (String(server.revision ?? 0) !== row.revision) return false
  if (server.transport === 'stdio' && !minRole(invoker.role, 'admin')) return false // prettier-ignore

  return isMcpServerSelected(agent, server)
}

export async function inspect(ctx: QueryCtx, scope: McpRuntimeScope) {
  const sessionId = ctx.db.normalizeId('sessions', scope.sessionId)
  const agentId = ctx.db.normalizeId('agents', scope.agentId)
  if (!sessionId || !agentId) return null

  const row = await ctx.db
    .query('mcpRuntimes')
    .withIndex('by_sessionId_agentId_serverKey', (q) =>
      q
        .eq('sessionId', sessionId)
        .eq('agentId', agentId)
        .eq('serverKey', scope.serverId),
    )
    .unique()

  if (!matchesCurrentRuntime(row, scope.key)) return null
  if (!(await isAuthorized(ctx, row))) return null
  return row
}

export async function catalogRuntime(
  ctx: QueryCtx,
  args: { runtimeId: Id<'mcpRuntimes'>; key: string },
) {
  const runtime = await ctx.db.get(args.runtimeId)
  if (!runtime || runtime.key !== args.key || runtime.state !== 'connected')
    return null
  if (!(await isAuthorized(ctx, runtime))) return null
  return {
    scope: runtimeScope(runtime),
    bootId: runtime.bootId,
    generation: runtime.generation,
  }
}

export async function owned(ctx: AuthQueryCtx, { runtimeId }: McpRuntimeArgs) {
  const row = await ctx.db.get(runtimeId)
  if (!row) error('Not found', 404)
  if (row.ownerId !== ctx.userId) error('Not found', 404)
  return row
}

export async function list(
  ctx: AuthQueryCtx,
  { serverKey, paginationOpts }: McpRuntimeListArgs,
) {
  return ctx.db
    .query('mcpRuntimes')
    .withIndex('by_ownerId_serverKey', (q) =>
      q.eq('ownerId', ctx.userId).eq('serverKey', serverKey),
    )
    .order('desc')
    .paginate(paginationOpts)
}

export async function control(
  ctx: AuthMutationCtx,
  args: McpRuntimeControlArgs,
) {
  const row = await owned(ctx, args)

  const servers = await resolve(ctx, row.ownerId, {
    agentId: row.agentId,
    sessionId: row.sessionId,
  })
  const server = servers.find((server) => server.id === row.serverKey)
  if (server?.transport === 'stdio' && !minRole(ctx.role, 'admin')) {
    error('Forbidden', 403)
  }

  await retire(
    ctx,
    row,
    args.reconnect ? 'Reconnecting' : 'Disconnected by owner',
  )

  if (args.reconnect) await reconnectRuntime(ctx, row, server)
}

async function reconnectRuntime(
  ctx: MutationCtx,
  row: Runtime,
  server: McpServer | undefined,
) {
  if (!server?.enabled) {
    error('Enable and save the server before reconnecting', 409)
  }
  if (!mcpConnectionSchema.safeParse(server).success) {
    error('Enable and save the server before reconnecting', 409)
  }

  const session = await getSessionWithWorkspace(ctx, row.sessionId)
  if (!session) error('Session is unavailable', 409)
  if (session.contextLock) error('Session is unavailable', 409)

  await ctx.db.patch(row._id, {
    epoch: (row.epoch ?? 0) + 1,
    key: `${row._id}:${(row.epoch ?? 0) + 1}`,
    state: 'connecting',
    reason: undefined,
    bootId: undefined,
    generation: undefined,
    initialization: undefined,
    revision: String(server.revision ?? 0),
    workspaceKey: workspaceKey(session.workspace),
    updatedAt: Date.now(),
  })
}

/** Applies status only while the authorized runtime identity is still current. */
export async function updateStatus(
  ctx: MutationCtx,
  args: McpRuntimeStatusArgs,
) {
  const row = await ctx.db.get(args.runtimeId)
  if (!matchesCurrentRuntime(row, args.key)) return
  await ctx.db.patch(row._id, {
    state: args.state,
    reason: args.reason,
    updatedAt: Date.now(),
  })
}

export async function retireCurrent(
  ctx: MutationCtx,
  args: McpRuntimeRetireArgs,
) {
  const row = await ctx.db.get(args.runtimeId)
  if (!matchesCurrentRuntime(row, args.key)) return
  await retire(ctx, row, args.reason)
}

export function page(
  ctx: QueryCtx,
  { state, paginationOpts }: McpRuntimePageArgs,
) {
  return ctx.db
    .query('mcpRuntimes')
    .withIndex('by_state', (q) => q.eq('state', state))
    .paginate(paginationOpts)
}

/** Fences late acknowledgements and teardown requests against replacement runtimes. */
function matchesCurrentRuntime(
  row: Runtime | null,
  key: string,
): row is Runtime {
  if (!row) return false
  if (row.key !== key) return false
  return row.state !== 'disconnected'
}

/** Child sessions inherit membership checks, but never their parent's runtime identity. */
export async function hasInvocationAccess(
  ctx: QueryCtx,
  sessionId: Id<'sessions'>,
  userId: Id<'users'>,
) {
  let session = await ctx.db.get(sessionId)
  const seen = new Set<string>()
  while (session?.parent) {
    if (seen.has(session._id)) return false
    seen.add(session._id)
    session = await ctx.db.get(session.parent.sessionId)
  }
  return !!session && !!(await getMembership(ctx, session._id, userId))
}

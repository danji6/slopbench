'use node'

import type { McpRuntimeStatus } from '@sb/core/types'
import type { PaginationResult } from 'convex/server'

import { api, internal } from '../_generated/api'
import type { Doc } from '../_generated/dataModel'
import type { ActionCtx } from '../_generated/server'
import type { McpCleanupArgs, McpRuntimeArgs } from '../types'
import { runtimeScope } from './mcpRuntime'
import { getSidecar, postSidecar } from './sidecar'

type Runtime = Doc<'mcpRuntimes'>
type Snapshot = { bootId: string; runtimes: McpRuntimeStatus[] }
type Reconciliation = {
  capturedAt: number
  bootId: string
  remaining: Map<string, McpRuntimeStatus>
}

/** Retries journaled revocation independently of the settings request. */
export async function cleanup(ctx: ActionCtx, args: McpCleanupArgs) {
  const row = await ctx.runQuery(internal.mcp._cleanup, args)
  if (!row) return
  await postSidecar('/mcp-ext/disconnect', { scope: row.scope })
  await ctx.runMutation(internal.mcp._cleanupDone, args)
}

/** Reconciles live processes with durable ownership and current configuration. */
export async function reconcile(ctx: ActionCtx): Promise<void> {
  await retryCleanups(ctx)
  const capturedAt = Date.now()
  const snapshot = await getSidecar<Snapshot>('/mcp-ext/runtimes')

  const reconciliation: Reconciliation = {
    capturedAt,
    bootId: snapshot.bootId,
    remaining: new Map(
      snapshot.runtimes.map((status) => [status.scope.key, status]),
    ),
  }

  for (const state of ['connecting', 'connected']) {
    await reconcileState(ctx, state, reconciliation)
  }
  for (const status of reconciliation.remaining.values()) {
    await postSidecar('/mcp-ext/disconnect', { scope: status.scope })
  }
}

async function retryCleanups(ctx: ActionCtx) {
  const pending = await ctx.runQuery(internal.mcp._pendingCleanups, {})
  for (const row of pending) {
    try {
      await ctx.runAction(internal.actions.mcp._cleanup, { cleanupId: row._id })
    } catch {
      /* The next reconciliation retries teardown. */
    }
  }
}

async function reconcileState(
  ctx: ActionCtx,
  state: string,
  reconciliation: Reconciliation,
) {
  let cursor: string | null = null
  do {
    const page: PaginationResult<Runtime> = await ctx.runQuery(
      internal.mcp._runtimePage,
      { state, paginationOpts: { cursor, numItems: 64 } },
    )
    for (const row of page.page) {
      await reconcileRuntime(ctx, row, reconciliation)
    }
    cursor = page.isDone ? null : page.continueCursor
  } while (cursor)
}

async function reconcileRuntime(
  ctx: ActionCtx,
  row: Runtime,
  reconciliation: Reconciliation,
) {
  const status = reconciliation.remaining.get(row.key)
  reconciliation.remaining.delete(row.key)

  const allowed = await ctx.runQuery(internal.mcp._inspectRuntime, {
    scope: runtimeScope(row),
  })

  if (!allowed) {
    await ctx.runMutation(internal.mcp._retireRuntime, {
      runtimeId: row._id,
      key: row.key,
      reason: 'MCP access or configuration changed',
    })
    return
  }
  if (snapshotMissedConnection(row, status, reconciliation.capturedAt)) {
    return
  }

  await recordSnapshotStatus(ctx, row, status, reconciliation.bootId)
}

/** Defers loss detection for an unstarted connection or a newer backend acknowledgement. */
function snapshotMissedConnection(
  row: Runtime,
  status: McpRuntimeStatus | undefined,
  capturedAt: number,
) {
  if (status) return false
  if (!row.bootId) return true
  return row.updatedAt > capturedAt
}

async function recordSnapshotStatus(
  ctx: ActionCtx,
  row: Runtime,
  status: McpRuntimeStatus | undefined,
  bootId: string,
) {
  const sidecarRestarted = row.bootId && row.bootId !== bootId
  await ctx.runMutation(internal.mcp._updateRuntimeStatus, {
    runtimeId: row._id,
    key: row.key,
    state: sidecarRestarted ? 'lost' : (status?.state ?? 'lost'),
    reason:
      sidecarRestarted || !status
        ? 'MCP session lost; reconnect explicitly'
        : status.reason,
  })
}

export async function runtimeStatus(
  ctx: ActionCtx,
  args: McpRuntimeArgs,
): Promise<McpRuntimeStatus | null> {
  const row = await ctx.runQuery(api.mcp.runtime, args)

  const status = await postSidecar<McpRuntimeStatus | null>('/mcp-ext/status', {
    scope: runtimeScope(row),
  })
  if (!status && !row.bootId) return null

  await ctx.runMutation(internal.mcp._updateRuntimeStatus, {
    runtimeId: row._id,
    key: row.key,
    state: status?.state ?? 'lost',
    reason:
      status?.reason ??
      (status ? undefined : 'MCP session lost; reconnect explicitly'),
  })

  return status
}

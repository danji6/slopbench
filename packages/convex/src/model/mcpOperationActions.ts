'use node'

import type { McpOperationStatus } from '@sb/core/types/mcp-operation'
import {
  type McpResult,
  decodeMcpOutput,
  mcpResultPreview,
  mcpResultSchema,
} from '@sb/core/types/mcp-result'

import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import type { ActionCtx } from '../_generated/server'
import type {
  McpOperationArgs,
  McpOperationExecutionArgs,
  StreamExecutionArgs,
} from '../types'
import { outputValidationError } from './mcpOperationValidation'
import { sidecarRequest } from './sidecarTransport'
import { OFFLOAD_THRESHOLD } from './stream/toolOutput'
import { getSidecarUrl } from './tool/mcp'

type Operation = Doc<'mcpOperations'>
type OperationPage = {
  items: Array<McpOperationStatus & { scope: Operation['scope'] }>
  nextCursor: string | null
}
const ROUTE = '/mcp-ext/operations'
const POLL_MS = 1000

type WatchOptions = {
  signal?: AbortSignal
  deadlineAt?: number
  pollMs?: number
}

/** HTTP watcher loss only detaches; durable Stop/revocation owns cancellation. */
export async function waitForOperation(
  ctx: ActionCtx,
  execution: StreamExecutionArgs,
  operationId: Id<'mcpOperations'>,
  options: WatchOptions = {},
): Promise<Operation | null> {
  const args = { ...execution, operationId }
  let lastHeartbeat = 0

  while (!options.signal?.aborted) {
    if (options.deadlineAt && Date.now() >= options.deadlineAt) return null

    const operation = await ctx.runQuery(internal.mcpOperations._get, args)
    if (operation.state !== 'running') return operation

    if (Date.now() - lastHeartbeat >= 60_000) {
      await ctx.runMutation(internal.streams._heartbeat, execution)
      lastHeartbeat = Date.now()
    }

    const result = await pollOperation(ctx, args, operation)
    if (result && result.state !== 'running') {
      await settle(ctx, { operationId }).catch(() => {})
      return result
    }

    await pause(options.pollMs ?? POLL_MS, options.signal)
  }

  return null
}

async function pollOperation(
  ctx: ActionCtx,
  args: McpOperationExecutionArgs,
  operation: Operation,
) {
  const recoveryDeadline =
    operation._creationTime + operation.maxTotalTimeoutMs + 30_000

  if (Date.now() >= recoveryDeadline) {
    return ctx.runMutation(internal.mcpOperations._observe, {
      ...args,
      state: 'lost',
      error:
        'MCP operation exceeded its recovery deadline; outcome unknown. This operation will not be replayed.',
    })
  }

  const { authorization, expiresAt } = await ctx.runQuery(
    internal.mcpOperations._allowed,
    args,
  )

  if (authorization !== 'allowed') {
    return ctx.runMutation(internal.mcpOperations._observe, {
      ...args,
      state: authorization === 'lost' ? 'lost' : 'cancelled',
      error:
        'MCP access revoked or session lost. Outcome may be unknown; cancellation does not imply rollback.',
    })
  }

  return refreshOperation(ctx, args, operation, expiresAt)
}

async function refreshOperation(
  ctx: ActionCtx,
  args: McpOperationExecutionArgs,
  operation: Operation,
  expiresAt: number,
) {
  let update: Awaited<ReturnType<typeof readUpdate>>
  try {
    const status = await startOperation(operation, expiresAt)
    update = await readUpdate(operation, status)
  } catch (error) {
    if (error instanceof OperationRejected) {
      return ctx.runMutation(internal.mcpOperations._observe, {
        ...args,
        state: 'failed',
        error: error.message,
      })
    }
    // Start retries attach to the same journal; a new sidecar returns lost
    return null
  }

  // Backend persistence errors must surface instead of becoming transport retries
  const stored =
    update.state === 'completed'
      ? await storeResult(ctx, args, operation, update.result)
      : update
  return ctx.runMutation(internal.mcpOperations._observe, {
    ...args,
    ...stored,
  })
}

function startOperation(operation: Operation, expiresAt: number) {
  return operationRequest<McpOperationStatus>(`${ROUTE}/start`, {
    id: operation._id,
    scope: operation.scope,
    bootId: operation.bootId,
    generation: operation.generation,
    expiresAt,
    name: operation.toolName,
    protocol: operation.protocolMethod
      ? { ...JSON.parse(operation.args), method: operation.protocolMethod }
      : undefined,
    args: JSON.parse(operation.args),
    requestTimeoutMs: operation.requestTimeoutMs,
    maxTotalTimeoutMs: operation.maxTotalTimeoutMs,
    deadlineAt: operation._creationTime + operation.maxTotalTimeoutMs,
  })
}

async function readUpdate(operation: Operation, status: McpOperationStatus) {
  const sessionChanged =
    status.bootId !== operation.bootId ||
    status.generation !== operation.generation
  if (sessionChanged) {
    return {
      state: 'lost' as const,
      error:
        'MCP operation session changed; outcome unknown. This operation will not be replayed.',
    }
  }
  if (status.state !== 'completed') {
    return {
      state: status.state,
      progress: status.progress,
      error: status.error,
    }
  }

  const response = await fetch(
    getSidecarUrl(`${ROUTE}/result`),
    sidecarRequest({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: operation._id, scope: operation.scope }),
      signal: AbortSignal.timeout(30_000),
    }),
  )
  if (!response.ok) throw new Error('Full MCP result unavailable')

  return {
    state: 'completed' as const,
    result: mcpResultSchema.parse(await response.json()),
  }
}

async function storeResult(
  ctx: ActionCtx,
  execution: StreamExecutionArgs,
  operation: Operation,
  fullResult: McpResult,
) {
  fullResult.origin.operationId = operation._id
  fullResult.origin.display = operation.display
  const error = await outputValidationError(
    ctx,
    {
      streamId: execution.streamId,
      generation: execution.generation,
      operationId: operation._id,
    },
    fullResult,
  )
  const text = JSON.stringify(fullResult)
  const stored = new Blob([text], { type: 'application/json' })
  if (stored.size <= OFFLOAD_THRESHOLD) {
    return { state: 'completed' as const, output: text, error }
  }

  const outputRef = await trackResult(ctx, execution, operation, stored)
  return {
    state: 'completed' as const,
    error,
    output: JSON.stringify(mcpResultPreview(fullResult)),
    outputRef,
  }
}

async function trackResult(
  ctx: ActionCtx,
  execution: StreamExecutionArgs,
  operation: Operation,
  blob: Blob,
) {
  const storageId = await ctx.storage.store(blob)
  try {
    const tracked = await ctx.runMutation(
      internal.streams._trackOffloadedOutput,
      {
        streamId: execution.streamId,
        generation: execution.generation,
        messageId: operation.messageId,
        storageId,
      },
    )
    if (!tracked) throw new Error('MCP result watcher lost turn ownership')
    return storageId
  } catch (error) {
    await ctx.storage.delete(storageId).catch(() => {})
    throw error
  }
}

/** Acknowledges only results already committed to durable backend storage. */
export async function settle(
  ctx: ActionCtx,
  { operationId }: McpOperationArgs,
) {
  const operation = await ctx.runQuery(internal.mcpOperations._inspect, {
    operationId,
  })
  if (!operation || operation.state === 'running' || operation.acknowledged) {
    return
  }

  const access = { id: operationId, scope: operation.scope }
  if (operation.deleted) {
    await operationRequest(`${ROUTE}/cancel`, access)
    await operationRequest(`${ROUTE}/forget`, access)
    await ctx.runMutation(internal.mcpOperations._forgetDeleted, { operationId }) // prettier-ignore
    return
  }
  if (operation.state !== 'completed') {
    await operationRequest(`${ROUTE}/cancel`, access)
  }
  await operationRequest(`${ROUTE}/acknowledge`, access)
  await ctx.runMutation(internal.mcpOperations._acknowledged, { operationId })
}

/** Settles pending MCP results before the next model step or stream handoff. */
export async function resumeOperations(
  ctx: ActionCtx,
  execution: StreamExecutionArgs,
  deadlineAt: number,
) {
  const operations = await ctx.runQuery(
    internal.mcpOperations._pending,
    execution,
  )

  for (const operation of operations) {
    const result = await waitForOperation(ctx, execution, operation._id, { deadlineAt }) // prettier-ignore
    if (!result) return false
    await ctx.runMutation(internal.mcpOperations._deliver, {
      ...execution,
      operationId: operation._id,
    })
    await settle(ctx, { operationId: operation._id }).catch(() => {})
  }

  return true
}

export async function operationOutput(ctx: ActionCtx, operation: Operation) {
  if (operation.state !== 'completed') {
    throw new Error(operation.error ?? `MCP operation ${operation.state}`)
  }
  if (!operation.outputRef) return decodeMcpOutput(operation.output ?? '')

  const blob = await ctx.storage.get(operation.outputRef)
  if (!blob) throw new Error('Stored MCP result unavailable')

  const stored: unknown = JSON.parse(await blob.text())
  return typeof stored === 'string'
    ? decodeMcpOutput(stored)
    : mcpResultSchema.parse(stored)
}

function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal?.addEventListener('abort', finish, { once: true })
    if (signal?.aborted) finish()
  })
}

class OperationRejected extends Error {}

async function operationRequest<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(
    getSidecarUrl(path),
    sidecarRequest({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    }),
  )
  const result = (await response.json()) as T & { error?: string }

  if (!response.ok) {
    const message = result.error ?? 'MCP operation request failed'
    if (
      response.status === 400 ||
      message.includes('capacity reached') ||
      message.includes('identity was reused')
    ) {
      throw new OperationRejected(message)
    }
    throw new Error(message)
  }

  return result
}

/** Retries acknowledgement and reclaims journals whose durable owner was deleted. */
export async function reconcileOperations(ctx: ActionCtx): Promise<void> {
  const pending = await ctx.runQuery(internal.mcpOperations._unsettled, {})

  for (const operation of pending) {
    await settle(ctx, { operationId: operation._id }).catch(() => {})
  }

  let cursor: string | null = null
  while (true) {
    const page: OperationPage = await operationRequest(`${ROUTE}/list`, {
      cursor,
      limit: 64,
    })
    for (const item of page.items) {
      const exists = await ctx.runQuery(internal.mcpOperations._inspect, {
        operationId: item.id as Id<'mcpOperations'>,
      })
      if (exists) continue
      const access = { id: item.id, scope: item.scope }
      await operationRequest(`${ROUTE}/cancel`, access)
      await operationRequest(`${ROUTE}/forget`, access).catch(() => {})
    }
    if (!page.nextCursor) break
    cursor = page.nextCursor
  }
}

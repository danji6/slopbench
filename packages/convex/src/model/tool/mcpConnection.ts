import { mcpConnectionSchema } from '@sb/core/types'
import type {
  McpRuntimeScope,
  McpRuntimeStatus,
  McpServer,
} from '@sb/core/types'

import type { Id } from '../../_generated/dataModel'
import { ToolError } from '../../errors'
import { sidecarUrl } from '../sidecar'
import { sidecarRequest } from '../sidecarTransport'

export type RuntimeAuthorization = {
  runtimeId: Id<'mcpRuntimes'>
  scope: McpRuntimeScope
  bootId?: string
  generation?: string
  expiresAt: number
}

export type McpConnected = (
  runtimeId: Id<'mcpRuntimes'>,
  key: string,
  bootId: string,
  generation: string,
  initialization?: string,
) => Promise<boolean>

export type McpFailed = (
  runtimeId: Id<'mcpRuntimes'>,
  key: string,
  reason: string,
) => Promise<void>

type Callbacks = { connected?: McpConnected; failed?: McpFailed }

export function getSidecarUrl(path: string, root = sidecarUrl()) {
  return new URL(path, root).toString()
}

export async function externalRequest<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    getSidecarUrl(path),
    sidecarRequest({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    }),
  )
  const data = (await response.json()) as T & { error?: string }
  if (!response.ok || data.error)
    throw new ToolError(data.error ?? `HTTP ${response.status}`)
  return data
}

/** Accepts a connected generation only while the backend still authorizes its runtime. */
export async function connectMcpRuntime(
  server: McpServer,
  runtime: RuntimeAuthorization,
  callbacks: Callbacks,
  signal?: AbortSignal,
) {
  let status: McpRuntimeStatus
  try {
    status = await externalRequest<McpRuntimeStatus>(
      '/mcp-ext/connect',
      { ...runtime, connection: mcpConnectionSchema.parse(server) },
      signal,
    )
  } catch (error) {
    await callbacks.failed?.(
      runtime.runtimeId,
      runtime.scope.key,
      error instanceof Error ? error.message : 'MCP connection lost',
    )
    throw error
  }
  const accepted = await callbacks.connected?.(
    runtime.runtimeId,
    runtime.scope.key,
    status.bootId,
    status.generation,
    status.initialization,
  )
  if (!accepted) {
    await externalRequest('/mcp-ext/disconnect', {
      scope: runtime.scope,
    }).catch(() => {})
    throw new ToolError('MCP execution was revoked during connection')
  }
  return status
}

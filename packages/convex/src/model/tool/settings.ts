import {
  type McpServer,
  type WebSearchInstance,
  isMcpUrl,
  isSearchEngineId,
} from '@sb/core/types'

import type { Doc } from '../../_generated/dataModel'

export type WebToolSettings = Pick<Doc<'settings'>, 'webSearchInstances'> | null

/** Everything outside the agent that its tools need to build. */
export type ToolResources = {
  settings: Pick<
    Doc<'settings'>,
    'webSearchInstances' | 'allowInteractiveShells'
  > | null
  mcpServers: McpServer[]
}

export const EMPTY_TOOL_RESOURCES: ToolResources = {
  settings: null,
  mcpServers: [],
}

export function normalizeWebSearchInstances(
  instances: unknown,
): WebSearchInstance[] {
  if (!Array.isArray(instances)) return []

  const seen = new Set<string>()
  const normalized: WebSearchInstance[] = []

  for (const instance of instances) {
    if (!instance || typeof instance !== 'object') continue
    const record = instance as Record<string, unknown>
    const engine = record.engine
    const url = typeof record.url === 'string' ? record.url.trim() : ''
    if (!isSearchEngineId(engine) || !isHttpUrl(url)) continue

    const key = `${engine}:${url}`
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push({ engine, url })
  }

  return normalized
}

/** Configured servers with a local command or a compatible network URL. */
export function enabledMcpServers(servers: McpServer[]): McpServer[] {
  return servers.filter(
    (server) =>
      server.enabled &&
      (server.transport === 'stdio'
        ? !!server.command?.trim()
        : isMcpUrl(server.url, server.transport)),
  )
}

export function isHttpUrl(value: string): boolean {
  if (!value) return false
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

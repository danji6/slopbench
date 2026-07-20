import {
  type McpServer,
  type WebSearchInstance,
  isSearchEngineId,
} from '@sb/core/types'

import type { Doc } from '../../_generated/dataModel'

export type WebToolSettings = Pick<
  Doc<'settings'>,
  'webSearchInstances' | 'mcpServers'
> | null

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

/** Configured MCP servers that are enabled and reachable over http(s). */
export function enabledMcpServers(settings?: WebToolSettings): McpServer[] {
  const servers = settings?.mcpServers
  if (!Array.isArray(servers)) return []
  return servers.filter((server) => server.enabled && isHttpUrl(server.url))
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

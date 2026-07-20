import {
  TOOL_DESCRIPTIONS,
  webFetchQuerySchema,
  webSearchQuerySchema,
} from '@sb/core/types'

import { ToolError } from '../../errors'
import { callMcpTool } from './mcp'
import { type WebToolSettings, normalizeWebSearchInstances } from './settings'

export async function createWebFetchTool() {
  const { tool } = await import('ai')
  return tool({
    description: TOOL_DESCRIPTIONS.web_fetch,
    inputSchema: webFetchQuerySchema,
    execute: (input, { abortSignal }) =>
      callMcpTool('web_fetch', input, abortSignal),
  })
}

export async function createWebSearchTool(settings?: WebToolSettings) {
  const { tool } = await import('ai')
  return tool({
    description: TOOL_DESCRIPTIONS.web_search,
    inputSchema: webSearchQuerySchema,
    execute: (input, { abortSignal }) => {
      const instances = normalizeWebSearchInstances(
        settings?.webSearchInstances,
      )
      if (instances.length === 0) {
        throw new ToolError('Web search is not configured.')
      }
      return callMcpTool('web_search', { ...input, instances }, abortSignal)
    },
  })
}

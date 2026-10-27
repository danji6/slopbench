import { ToolBlock } from '@/components/chat/messages/tool-block'
import { StreamStoreProvider } from '@/hooks/chat/stream'
import { mcpResult, mcpResultPreview } from '@sb/core/types/mcp-result'
import type { ToolUIPart } from 'ai'
import { ConvexProvider, type ConvexReactClient } from 'convex/react'
import { type FunctionReference, getFunctionName } from 'convex/server'

const client = {
  watchQuery(reference: FunctionReference<'query'>) {
    return {
      onUpdate: () => () => {},
      localQueryResult: () =>
        getFunctionName(reference) === 'chat:getToolOutputUrl'
          ? `${location.origin}/mcp-output.json`
          : null,
      localQueryLogs: () => [],
      journal: () => undefined,
    }
  },
} as unknown as ConvexReactClient

/** Exercises the production output loader and tool block without a backend. */
export function McpToolFixture() {
  const params = new URLSearchParams(location.search)
  const tool = params.get('tool') ?? 'call_mcp_tool'
  const inline = params.has('inline')
  const output = mcpResult(
    { content: [{ type: 'text', text: 'Retained output' }] },
    { serverId: 'fixture', name: 'binary_session' },
  )
  const part = {
    type: `tool-${tool}`,
    toolCallId: 'mcp-output',
    state: 'output-available',
    input:
      tool === 'call_mcp_tool'
        ? { tool: 'binary_session', arguments: {} }
        : { server: 'REA', method: 'get_server_info' },
    output: inline ? output : mcpResultPreview(output),
    ...(inline ? {} : { outputRef: 'stored-result' }),
    ...(params.has('progress')
      ? {
          mcpProgress: {
            message: 'ghidra_startup: Waiting for Ghidra startup (20s elapsed)',
            progress: 3,
          },
        }
      : {}),
  } as ToolUIPart

  return (
    <ConvexProvider client={client}>
      <StreamStoreProvider>
        <main className="mx-auto max-w-xl p-4">
          <ToolBlock part={part} messageId="fixture" />
        </main>
      </StreamStoreProvider>
    </ConvexProvider>
  )
}

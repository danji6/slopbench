import { consumeProviderStep } from '@sb/convex/actions/stream/engineStep'
import { setApprovalMode } from '@sb/convex/model/session/state'
import { getEnabledTools } from '@sb/convex/model/tool/build'
import { type ToolSet, tool } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, expect, mock, test } from 'bun:test'
import { z } from 'zod'
import { mcpCatalogBackend } from '~/tests/helpers/mcp-catalog-backend'

let active: Awaited<ReturnType<typeof mcpCatalogBackend>> | undefined
afterEach(async () => {
  await active?.close()
  active = undefined
})

function model() {
  const calls = [
    ['mcp_protocol', { server: 'Local', method: 'get_server_info' }],
    ['independent', {}],
    ['call_mcp_tool', { tool: 'tool_000', arguments: {} }],
    ['local_status', {}],
  ] as const
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          for (const [toolName, input] of calls) {
            controller.enqueue({
              type: 'tool-call',
              toolName,
              toolCallId: toolName,
              input: JSON.stringify(input),
            })
          }
          controller.enqueue({
            type: 'finish',
            finishReason: { unified: 'tool-calls', raw: undefined },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          })
          controller.close()
        },
      }),
    }),
  })
}

test.each(['lost', 'disconnected'])(
  '%s MCP runtimes fail individual calls without interrupting the provider step or dispatching',
  async (state) => {
    const f = (active = await mcpCatalogBackend())
    await f.publish()
    await f.target('tool_000')
    await setApprovalMode(f.ctx, f.sessionId, 'unrestricted')
    const runtime = f.rows('mcpRuntimes')[0]
    await f.db.patch(runtime._id, {
      state,
      reason: 'Sidecar restarted during the previous turn',
    })
    await f.sidecar.registry.disconnect(f.status.scope)
    const tools: ToolSet = await getEnabledTools(
      {
        names: ['call_mcp_tool', 'mcp_protocol', 'local_status'],
        mcp: [
          {
            name: 'local_status',
            serverId: 'local',
            toolName: 'tool_000',
            inputSchema: '{"type":"object"}',
          },
        ],
      },
      { _id: f.sessionId },
      undefined,
      {
        ctx: f.action,
        execution: f.execution,
        messageId: f.messageId,
        agentId: f.agentId,
      },
    )
    const independent = mock(async () => 'Still available')
    tools.independent = tool({
      inputSchema: z.object({}),
      execute: independent,
    })
    const setup = {
      output: { _id: f.messageId, role: 'assistant', parts: [] },
      stream: { sessionId: f.sessionId, invokedBy: 'owner' },
      agent: {},
      evalResult: {},
      requestLog: {},
      tools,
      messages: [{ role: 'user', content: 'Check the session and continue.' }],
      resolved: { languageModel: model() },
    } as unknown as Parameters<typeof consumeProviderStep>[2]

    const result = await consumeProviderStep(
      f.action,
      f.execution,
      setup,
      Date.now() + 60_000,
    )
    expect(result.shouldContinue).toBe(true)
    expect(result.hasOutput.toolErrors.sort()).toEqual([
      'call_mcp_tool',
      'local_status',
      'mcp_protocol',
    ])
    expect(independent).toHaveBeenCalledTimes(1)
    const parts = (await f.db.get(f.contentId))?.parts
    expect(parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool-independent',
          state: 'output-available',
          output: 'Still available',
        }),
      ]),
    )
    for (const name of ['call_mcp_tool', 'local_status', 'mcp_protocol']) {
      expect(parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: `tool-${name}`,
            state: 'output-error',
            errorText: expect.stringContaining(
              'Sidecar restarted during the previous turn',
            ),
          }),
        ]),
      )
    }
    expect(f.rows('mcpOperations')).toHaveLength(0)
    expect(f.sidecar.registry.list()).toHaveLength(0)
    expect(f.rows('mcpRuntimes')[0].key).toBe(runtime.key)
  },
  15_000,
)

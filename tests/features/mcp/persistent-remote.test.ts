import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { McpRegistry } from '@sb/sidecar/mcp/external/registry'
import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mcpText } from '~/tests/helpers/mcp-result'

test('remote clients preserve independent state and HTTP session identifiers', async () => {
  const transports = new Map<string, WebStandardStreamableHTTPServerTransport>()
  let starts = 0
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const id = request.headers.get('mcp-session-id')
      let transport = id ? transports.get(id) : undefined
      if (!transport) {
        starts++
        let count = 0
        const mcp = new McpServer({ name: 'stateful-remote', version: '1' })
        mcp.registerTool('counter', { inputSchema: {} }, () => ({
          content: [{ type: 'text', text: String(++count) }],
        }))
        transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          enableJsonResponse: true,
          onsessioninitialized: (sessionId) => {
            transports.set(sessionId, transport!)
          },
        })
        await mcp.connect(transport)
      }
      return transport.handleRequest(request)
    },
  })
  const registry = new McpRegistry()
  const connection = {
    transport: 'http' as const,
    url: `http://localhost:${server.port}/mcp`,
  }
  const scope = (key: string) => ({
    key,
    ownerId: 'owner',
    sessionId: key,
    agentId: 'agent',
    serverId: 'remote',
    revision: '1',
  })
  try {
    const first = await registry.connect(scope('one'), connection)
    expect(
      mcpText(await registry.call(first.scope, 'counter', {}, first)),
    ).toBe('1')
    await registry.connect(first.scope, connection, first)
    expect(
      mcpText(await registry.call(first.scope, 'counter', {}, first)),
    ).toBe('2')
    const second = await registry.connect(scope('two'), connection)
    expect(
      mcpText(await registry.call(second.scope, 'counter', {}, second)),
    ).toBe('1')
    expect(starts).toBe(2)
  } finally {
    await registry.close()
    await Promise.all(
      [...transports.values()].map((transport) => transport.close()),
    )
    server.stop(true)
  }
})

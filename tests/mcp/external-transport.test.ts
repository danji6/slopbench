/// <reference types="bun-types" />
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { mcpTransportCandidates } from '@sb/core/types'
import { listExternalTools } from '@sb/sidecar/mcp/external/client'
import { afterEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'

type Server = {
  url: string
  stop: () => void
  postsTo: (path: string) => number
}

const servers: Server[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.stop()
})

function track(): {
  count: (path: string) => number
  record: (req: Request) => void
} {
  const posts = new Map<string, number>()
  return {
    count: (path) => posts.get(path) ?? 0,
    record: (req) => {
      if (req.method !== 'POST') return
      const { pathname } = new URL(req.url)
      posts.set(pathname, (posts.get(pathname) ?? 0) + 1)
    },
  }
}

function buildServer(): McpServer {
  const server = new McpServer({ name: 'stub', version: '1.0.0' })
  server.registerTool(
    'echo',
    { description: 'Echoes back', inputSchema: { text: z.string() } },
    ({ text }) => ({ content: [{ type: 'text' as const, text }] }),
  )
  return server
}

/** A server that speaks the current Streamable HTTP transport at `/mcp`. */
function serveStreamableHttp(): Server {
  const tracker = track()
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      tracker.record(req)
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      const mcp = buildServer()
      try {
        await mcp.connect(transport)
        return await transport.handleRequest(req)
      } finally {
        await transport.close()
        await mcp.close()
      }
    },
  })
  const entry = {
    url: `http://localhost:${server.port}/mcp`,
    stop: () => server.stop(true),
    postsTo: tracker.count,
  }
  servers.push(entry)
  return entry
}

const encoder = new TextEncoder()

function sseFrame(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

/**
 * A legacy HTTP+SSE server: it rejects the Streamable HTTP POST at `/mcp` and
 * only answers the deprecated GET-stream handshake, exactly like a server that
 * never migrated.
 */
function serveLegacySse(options: { status?: number } = {}): Server {
  const tracker = track()
  let sink: ReadableStreamDefaultController<Uint8Array> | undefined

  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      tracker.record(req)
      const { pathname } = new URL(req.url)

      if (req.method === 'GET' && pathname === '/mcp') {
        const stream = new ReadableStream<Uint8Array>({
          start: (controller) => {
            sink = controller
            controller.enqueue(
              encoder.encode(`event: endpoint\ndata: /messages\n\n`),
            )
          },
        })
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
          },
        })
      }

      if (req.method === 'POST' && pathname === '/messages') {
        const message = (await req.json()) as { id?: number; method?: string }
        if (message.method === 'initialize') {
          sink?.enqueue(
            sseFrame('message', {
              jsonrpc: '2.0',
              id: message.id,
              result: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: { name: 'legacy', version: '1.0.0' },
              },
            }),
          )
        } else if (message.method === 'tools/list') {
          sink?.enqueue(
            sseFrame('message', {
              jsonrpc: '2.0',
              id: message.id,
              result: {
                tools: [
                  {
                    name: 'echo',
                    description: 'Echoes back',
                    inputSchema: { type: 'object', properties: {} },
                  },
                ],
              },
            }),
          )
        }
        return new Response(null, { status: 202 })
      }

      // The Streamable HTTP probe lands here and is turned away.
      return new Response('Not Found', { status: options.status ?? 404 })
    },
  })

  const entry = {
    url: `http://localhost:${server.port}/mcp`,
    stop: () => {
      sink?.close()
      server.stop(true)
    },
    postsTo: tracker.count,
  }
  servers.push(entry)
  return entry
}

describe('MCP transport candidates', () => {
  test('auto prefers Streamable HTTP and keeps SSE as a fallback', () => {
    expect(mcpTransportCandidates('auto')).toEqual(['http', 'sse'])
  })

  test('an explicit transport is the only candidate', () => {
    expect(mcpTransportCandidates('sse')).toEqual(['sse'])
    expect(mcpTransportCandidates('ws')).toEqual(['ws'])
    expect(mcpTransportCandidates('http')).toEqual(['http'])
  })
})

describe('MCP transport negotiation', () => {
  test('auto lands on Streamable HTTP when the server speaks it', async () => {
    const server = serveStreamableHttp()

    const { value: tools, transport } = await listExternalTools({
      url: server.url,
      transport: 'auto',
    })

    expect(transport).toBe('http')
    expect(tools.map((tool) => tool.name)).toEqual(['echo'])
  })

  test('auto falls back to SSE for a server that never migrated', async () => {
    const server = serveLegacySse()

    const { value: tools, transport } = await listExternalTools({
      url: server.url,
      transport: 'auto',
    })

    expect(transport).toBe('sse')
    expect(tools.map((tool) => tool.name)).toEqual(['echo'])
    expect(server.postsTo('/mcp')).toBe(1)
  })

  test('a negotiated transport is reused instead of re-probing', async () => {
    const server = serveLegacySse()

    await listExternalTools({ url: server.url, transport: 'auto' })
    const { transport } = await listExternalTools({
      url: server.url,
      transport: 'auto',
    })

    expect(transport).toBe('sse')
    // Still the single probe from the first call: the second went straight to SSE.
    expect(server.postsTo('/mcp')).toBe(1)
  })

  test('an explicit transport surfaces its own failure, unwrapped', async () => {
    const server = serveLegacySse()

    const failure = await listExternalTools({
      url: server.url,
      transport: 'http',
    }).catch((err: unknown) => err)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).not.toContain('http or sse')
  })

  test('rejected credentials fail without probing the other transport', async () => {
    const server = serveLegacySse({ status: 401 })

    const failure = await listExternalTools({
      url: server.url,
      transport: 'auto',
      apiKey: 'bad-key',
    }).catch((err: unknown) => err)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).not.toContain('http or sse')
    // Only the Streamable HTTP attempt was made; SSE was never dialed.
    expect(server.postsTo('/messages')).toBe(0)
  })
})

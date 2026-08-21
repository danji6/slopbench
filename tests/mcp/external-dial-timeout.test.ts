/// <reference types="bun-types" />
import { listExternalTools } from '@sb/sidecar/mcp/external/client'
import { afterEach, describe, expect, test } from 'bun:test'

const encoder = new TextEncoder()

function sseFrame(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

const servers: Array<{ stop: () => void }> = []
let sink: ReadableStreamDefaultController<Uint8Array> | undefined

afterEach(() => {
  for (const server of servers.splice(0)) server.stop()
  sink = undefined
  delete process.env.MCP_DIAL_TIMEOUT_MS
})

/**
 * A server whose Streamable HTTP probe is accepted but never answered, while
 * the legacy GET handshake works — the shape that used to wedge discovery.
 */
function serveWedgedProbe(): {
  url: string
  stop: () => void
  probes: () => number
} {
  let probes = 0
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const { pathname } = new URL(req.url)

      if (req.method === 'POST' && pathname === '/mcp') {
        probes++
        return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }

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
                serverInfo: { name: 'wedged', version: '1.0.0' },
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

      return new Response('Not Found', { status: 404 })
    },
  })

  const entry = {
    url: `http://localhost:${server.port}/mcp`,
    stop: () => server.stop(true),
    probes: () => probes,
  }
  servers.push(entry)
  return entry
}

describe('MCP dial timeout', () => {
  test('a wedged Streamable HTTP probe falls through to SSE', async () => {
    process.env.MCP_DIAL_TIMEOUT_MS = '300'
    const server = serveWedgedProbe()

    const started = Date.now()
    const { value: tools, transport } = await listExternalTools({
      url: server.url,
      transport: 'auto',
    })

    expect(transport).toBe('sse')
    expect(tools.map((tool) => tool.name)).toEqual(['echo'])
    expect(server.probes()).toBe(1)
    expect(Date.now() - started).toBeLessThan(5_000)
  }, 10_000)
})

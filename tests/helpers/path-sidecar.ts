import { checkPaths } from '@sb/sidecar/mcp/workspace/check-paths'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** Exercise the real MCP client and path resolver without touching a running sidecar. */
export async function startPathSidecar() {
  const root = await mkdtemp(path.join(tmpdir(), 'approval-sidecar-'))
  await mkdir(path.join(root, 'src'))
  await mkdir(path.join(root, '.git'))
  await writeFile(path.join(root, 'src', 'file.txt'), 'fixture')
  const requests: Array<{ name: string; arguments: Record<string, unknown> }> =
    []
  let available = true
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST') return new Response(null, { status: 405 })
      if (!available) return new Response('Unavailable', { status: 503 })
      const body = (await request.json()) as {
        id?: number
        method: string
        params: { name: string; arguments: Record<string, unknown> }
      }
      if (body.id === undefined) return new Response(null, { status: 202 })
      if (body.method === 'initialize')
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'test', version: '1' },
          },
        })
      requests.push(body.params)
      const args = body.params.arguments
      const result =
        body.params.name === 'check_paths'
          ? await checkPaths(
              root,
              args as {
                paths: string[]
                allowedPaths?: string[]
                literal?: boolean
              },
            )
          : { ok: true }
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: { content: [{ type: 'text', text: JSON.stringify(result) }] },
      })
    },
  })
  const previous = process.env.SIDECAR_URL
  process.env.SIDECAR_URL = `http://localhost:${server.port}`
  return {
    root,
    requests,
    setAvailable(value: boolean) {
      available = value
    },
    async close() {
      server.stop(true)
      if (previous === undefined) delete process.env.SIDECAR_URL
      else process.env.SIDECAR_URL = previous
      await rm(root, { recursive: true, force: true })
    },
  }
}

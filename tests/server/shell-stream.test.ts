/// <reference types="bun-types" />
import type * as ShellToolModule from '@sb/convex/model/tool/shell'
import type { ShellToolOutput } from '@sb/convex/types'
import type * as RegistryModule from '@sb/sidecar/shell/registry'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

process.env.CHAT_JOB_MODE = 'script'
process.env.CHAT_SIDECAR_DATA_DIR ??= process.cwd()

const PORT = 39_312
// Read at import time by the sidecar client, so it must be set before it loads
process.env.SIDECAR_URL = `http://127.0.0.1:${PORT}`

let registry: typeof RegistryModule
let shellTool: typeof ShellToolModule
let server: ReturnType<typeof Bun.serve>

const context = { sessionId: 'session-1', workspaceId: 'ws-1' }

beforeAll(async () => {
  registry = await import('@sb/sidecar/shell/registry')
  shellTool = await import('@sb/convex/model/tool/shell')

  const app = new Hono()
  app.route('/shell', (await import('@sb/sidecar/shell/routes')).shellRoutes)
  server = Bun.serve({ port: PORT, fetch: (req) => app.fetch(req) })
})

afterAll(() => server?.stop(true))

/** Starts the job here, so the tool only has to watch it over real HTTP. */
async function startedJob(command: string) {
  const { jobId } = await registry.startShellJob({
    ...context,
    command,
    cwd: process.cwd(),
  })
  return { jobId, post: async () => ({ jobId, mode: 'script' }) }
}

/** Collects parts until `done` says stop, or the deadline passes. */
async function collect(
  parts: AsyncGenerator<ShellToolOutput>,
  done: (part: ShellToolOutput) => boolean,
  timeoutMs = 8_000,
) {
  const seen: ShellToolOutput[] = []
  const deadline = Date.now() + timeoutMs
  for await (const part of parts) {
    seen.push(part)
    if (done(part) || Date.now() > deadline) break
  }
  return seen
}

describe('shell job streaming over http', () => {
  /**
   * The whole point of the SSE push: a job that has not exited yet must still
   * surface its output. When only completed jobs report back, a command that
   * blocks (a pager waiting for a keypress) leaves the tool call with no
   * output at all — nothing to render, expand, or flag as waiting.
   */
  test('yields output while the job is still running', async () => {
    const { jobId, post } = await startedJob('echo streaming-live; sleep 30')

    const started = Date.now()
    const parts = shellTool.executeShellJob(context, { command: 'ignored' }, {
      post,
    } as Parameters<typeof shellTool.executeShellJob>[2])

    const seen = await collect(parts, (part) =>
      part.term.includes('streaming-live'),
    )
    const elapsed = Date.now() - started

    const live = seen.at(-1)
    expect(live?.status).toBe('running')
    expect(live?.term).toContain('streaming-live')
    // Well before the command itself could have finished
    expect(elapsed).toBeLessThan(10_000)

    registry.killShellJob(jobId, context.sessionId)
  })

  test('yields a final part once the job exits', async () => {
    const { post } = await startedJob('echo all-done')

    const seen = await collect(
      shellTool.executeShellJob(context, { command: 'ignored' }, {
        post,
      } as Parameters<typeof shellTool.executeShellJob>[2]),
      (part) => part.status !== 'running',
    )

    const final = seen.at(-1)
    expect(final?.status).toBe('done')
    expect(final?.exitCode).toBe(0)
    expect(final?.text).toContain('all-done')
  })

  test('reports a job waiting on terminal input', async () => {
    const { jobId, post } = await startedJob('read -r line; echo "got:$line"')

    const seen = await collect(
      shellTool.executeShellJob(context, { command: 'ignored' }, {
        post,
      } as Parameters<typeof shellTool.executeShellJob>[2]),
      (part) => part.waiting === true,
    )

    expect(seen.at(-1)?.waiting).toBe(true)

    registry.killShellJob(jobId, context.sessionId)
  })
})

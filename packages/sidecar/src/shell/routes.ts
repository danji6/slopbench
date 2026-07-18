import { type Context, Hono } from 'hono'
import { type SSEStreamingApi, streamSSE } from 'hono/streaming'
import { ZodError, z } from 'zod'

import { requireWorkspace } from '../mcp/workspace/workspace'
import {
  type ShellJobStream,
  type ShellStreamEvent,
  backgroundShellJob,
  killSessionShellJobs,
  killShellJob,
  listShellJobs,
  pollShellJob,
  resizeShellJob,
  startShellJob,
  subscribeShellJob,
  writeStdin,
} from './registry'

const jobFields = {
  sessionId: z.string(),
  jobId: z.string(),
}

const startSchema = z.object({
  sessionId: z.string(),
  workspaceId: z.string(),
  command: z.string().min(1),
  timeoutSeconds: z.number().optional(),
  background: z.boolean().optional(),
  cols: z.number().int().min(20).max(500).optional(),
  rows: z.number().int().min(5).max(300).optional(),
})

const pollSchema = z.object({ ...jobFields, offset: z.number().min(0) })
const streamSchema = z.object({
  ...jobFields,
  offset: z.coerce.number().min(0).default(0),
  // Ends the SSE response once this many payload bytes have been sent
  maxBytes: z.coerce.number().min(0).optional(),
})
const stdinSchema = z.object({ ...jobFields, data: z.string() })
const killSchema = z.object(jobFields)
const resizeSchema = z.object({
  ...jobFields,
  cols: z.number().int().min(20).max(500),
  rows: z.number().int().min(5).max(300),
})
const sessionSchema = z.object({ sessionId: z.string() })
const killSessionSchema = z.object({
  sessionId: z.string(),
  includeBackground: z.boolean().optional(),
})

export const shellRoutes = new Hono()

shellRoutes.post('/start', async (c) => {
  try {
    const input = startSchema.parse(await c.req.json())
    const workspace = await requireWorkspace(input.sessionId, input.workspaceId)
    const result = await startShellJob({ ...input, cwd: workspace.root })
    return c.json(result)
  } catch (err: unknown) {
    return jobError(c, err)
  }
})

shellRoutes.post('/poll', async (c) => {
  try {
    const input = pollSchema.parse(await c.req.json())
    return c.json(pollShellJob(input.jobId, input.sessionId, input.offset))
  } catch (err: unknown) {
    return jobError(c, err)
  }
})

shellRoutes.get('/stream', (c) => {
  let stream: ShellJobStream
  let maxBytes: number | undefined
  try {
    const parsed = streamSchema.parse({
      sessionId: c.req.query('sessionId'),
      jobId: c.req.query('jobId'),
      offset: c.req.query('offset'),
      maxBytes: c.req.query('maxBytes'),
    })
    maxBytes = parsed.maxBytes
    stream = subscribeShellJob(parsed.jobId, parsed.sessionId, parsed.offset)
  } catch (err: unknown) {
    return jobError(c, err)
  }
  return streamSSE(c, (sse) => pumpShellJobStream(sse, stream, maxBytes))
})

shellRoutes.post('/stdin', async (c) => {
  try {
    const input = stdinSchema.parse(await c.req.json())
    writeStdin(input.jobId, input.sessionId, input.data)
    return c.json({ ok: true })
  } catch (err: unknown) {
    return jobError(c, err)
  }
})

shellRoutes.post('/kill', async (c) => {
  try {
    const input = killSchema.parse(await c.req.json())
    killShellJob(input.jobId, input.sessionId)
    return c.json({ ok: true })
  } catch (err: unknown) {
    return jobError(c, err)
  }
})

shellRoutes.post('/background', async (c) => {
  try {
    const input = killSchema.parse(await c.req.json())
    backgroundShellJob(input.jobId, input.sessionId)
    return c.json({ ok: true })
  } catch (err: unknown) {
    return jobError(c, err)
  }
})

shellRoutes.post('/resize', async (c) => {
  try {
    const input = resizeSchema.parse(await c.req.json())
    resizeShellJob(input.jobId, input.sessionId, input.cols, input.rows)
    return c.json({ ok: true })
  } catch (err: unknown) {
    return jobError(c, err)
  }
})

shellRoutes.post('/list', async (c) => {
  try {
    const input = sessionSchema.parse(await c.req.json())
    return c.json({ jobs: listShellJobs(input.sessionId) })
  } catch (err: unknown) {
    return jobError(c, err)
  }
})

shellRoutes.post('/kill_session', async (c) => {
  try {
    const input = killSessionSchema.parse(await c.req.json())
    const killed = killSessionShellJobs(
      input.sessionId,
      input.includeBackground ?? false,
    )
    return c.json({ killed })
  } catch (err: unknown) {
    return jobError(c, err)
  }
})

const PING_MS = 15_000
const PING = Symbol('ping')

/** Replays the snapshot then pushes live events, with an idle keep-alive ping. */
async function pumpShellJobStream(
  sse: SSEStreamingApi,
  stream: ShellJobStream,
  maxBytes?: number,
) {
  const { initial, status, exitCode, background, waiting, registered, events } =
    stream
  let aborted = false
  let sent = 0
  sse.onAbort(() => {
    aborted = true
    stream.unsubscribe()
  })

  const budgetSpent = () => maxBytes !== undefined && sent >= maxBytes

  try {
    if (initial.chunk) {
      sent += await writeChunk(sse, {
        text: initial.chunk,
        nextOffset: initial.nextOffset,
        bufferStart: initial.bufferStart,
      })
    }

    if (!registered || status !== 'running') {
      await sse.writeSSE({
        event: 'end',
        data: JSON.stringify({ status, exitCode }),
      })
      return
    }

    if (budgetSpent()) return

    await sse.writeSSE({
      event: 'meta',
      data: JSON.stringify({ background, waiting }),
    })

    let pending = events.next()
    while (!aborted && !budgetSpent()) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const ping = new Promise<typeof PING>((resolve) => {
        timer = setTimeout(() => resolve(PING), PING_MS)
      })
      let result: IteratorResult<ShellStreamEvent> | typeof PING
      try {
        result = await Promise.race([pending, ping])
      } finally {
        clearTimeout(timer)
      }

      if (result === PING) {
        await sse.write(': ping\n\n')
        continue
      }
      if (result.done) break
      pending = events.next()
      const { open, bytes } = await writeEvent(sse, result.value)
      sent += bytes
      if (!open) break
    }
  } finally {
    stream.unsubscribe()
    await events.return?.(undefined).catch(() => {})
  }
}

/** Writes a chunk frame and returns the payload byte count. */
async function writeChunk(
  sse: SSEStreamingApi,
  payload: { text: string; nextOffset: number; bufferStart?: number },
): Promise<number> {
  const data = JSON.stringify(payload)
  await sse.writeSSE({ event: 'chunk', data })
  return data.length
}

/** Writes one event. `open` is false once the `end` event is sent. */
async function writeEvent(
  sse: SSEStreamingApi,
  ev: ShellStreamEvent,
): Promise<{ open: boolean; bytes: number }> {
  if (ev.type === 'chunk') {
    const bytes = await writeChunk(sse, {
      text: ev.text,
      nextOffset: ev.nextOffset,
    })
    return { open: true, bytes }
  }
  if (ev.type === 'meta') {
    await sse.writeSSE({
      event: 'meta',
      data: JSON.stringify({ background: ev.background, waiting: ev.waiting }),
    })
    return { open: true, bytes: 0 }
  }

  await sse.writeSSE({
    event: 'end',
    data: JSON.stringify({ status: ev.status, exitCode: ev.exitCode }),
  })
  return { open: false, bytes: 0 }
}

function jobError(c: Context, err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  const status =
    err instanceof ZodError ? 400 : message.includes('not found') ? 404 : 500
  return c.json({ error: message }, status)
}

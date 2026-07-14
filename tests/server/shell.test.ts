/// <reference types="bun-types" />
import {
  OutputRing,
  type ShellJobStatus,
  type ShellJobStream,
  type ShellStreamEvent,
  backgroundShellJob,
  killSessionForegroundShellJobs,
  killSessionShellJobs,
  killShellJob,
  listShellJobs,
  pollShellJob,
  startShellJob,
  subscribeShellJob,
  writeStdin,
} from '@sb/sidecar/shell/registry'
import { describe, expect, test } from 'bun:test'

process.env.CHAT_JOB_MODE = 'script'
process.env.CHAT_SIDECAR_DATA_DIR ??= process.cwd()

/** Lazy import: routes pull in workspace, which needs the data dir set above. */
async function getShellRoutes() {
  return (await import('@sb/sidecar/shell/routes')).shellRoutes
}

const session = { sessionId: 'session-1', workspaceId: 'ws-1' }

function start(command: string, overrides?: Record<string, unknown>) {
  return startShellJob({
    ...session,
    command,
    cwd: process.cwd(),
    ...overrides,
  })
}

async function waitForExit(jobId: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  let offset = 0
  let output = ''
  while (Date.now() < deadline) {
    const poll = pollShellJob(jobId, session.sessionId, offset)
    output += poll.chunk
    offset = poll.nextOffset
    if (poll.status !== 'running') return { ...poll, output }
    await Bun.sleep(50)
  }
  throw new Error('Job did not exit in time')
}

describe('job registry', () => {
  test('runs a command and captures output', async () => {
    const { jobId, mode } = await start('echo hello-job')
    expect(['pty', 'script', 'pipe']).toContain(mode)

    const result = await waitForExit(jobId)
    expect(result.status).toBe('done')
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('hello-job')
  })

  test('round-trips stdin', async () => {
    const { jobId } = await start('read line; echo "got:$line"')
    await Bun.sleep(200)
    writeStdin(jobId, session.sessionId, 'ping\n')

    const result = await waitForExit(jobId)
    expect(result.output).toContain('got:ping')
  })

  test('kills a running job', async () => {
    const { jobId } = await start('sleep 30')
    await Bun.sleep(100)
    killShellJob(jobId, session.sessionId)

    const result = await waitForExit(jobId)
    expect(result.status).toBe('killed')
  })

  test('times out a job', async () => {
    const { jobId } = await start('sleep 30', { timeoutSeconds: 0.3 })

    const result = await waitForExit(jobId)
    expect(result.status).toBe('timeout')
  })

  test('reports non-zero exit codes without failing', async () => {
    const { jobId } = await start('exit 3')

    const result = await waitForExit(jobId)
    expect(result.status).toBe('done')
    expect(result.exitCode).toBe(3)
  })

  test('rejects jobs from the wrong session', async () => {
    const { jobId } = await start('echo x')
    expect(() => pollShellJob(jobId, 'other-session', 0)).toThrow('not found')
    await waitForExit(jobId)
  })

  test('uses short, human-recognizable job ids', async () => {
    const { jobId } = await start('echo id-shape')
    expect(jobId).toMatch(/^shell-\d+$/)
    await waitForExit(jobId)
  })

  test('killSessionShellJobs with includeBackground stops background jobs too', async () => {
    const fg = await start('sleep 30')
    const bg = await start('sleep 30', { background: true })
    await Bun.sleep(100)

    const killed = killSessionShellJobs(session.sessionId, true)
    expect(killed).toBeGreaterThanOrEqual(2)

    const fgResult = await waitForExit(fg.jobId)
    expect(fgResult.status).toBe('killed')
    const bgResult = await waitForExit(bg.jobId)
    expect(bgResult.status).toBe('killed')
  })

  test('backgroundShellJob detaches a foreground job so cleanup spares it', async () => {
    const fg = await start('sleep 30')
    await Bun.sleep(100)

    backgroundShellJob(fg.jobId, session.sessionId)
    expect(pollShellJob(fg.jobId, session.sessionId, 0).background).toBe(true)

    // Foreground-only cleanup must now leave it running.
    killSessionForegroundShellJobs(session.sessionId)
    expect(pollShellJob(fg.jobId, session.sessionId, 0).status).toBe('running')

    killShellJob(fg.jobId, session.sessionId)
    await waitForExit(fg.jobId)
  })

  test('kill_session only kills foreground jobs', async () => {
    const fg = await start('sleep 30')
    const bg = await start('sleep 30', { background: true })
    await Bun.sleep(100)

    const killed = killSessionForegroundShellJobs(session.sessionId)
    expect(killed).toBeGreaterThanOrEqual(1)

    const fgResult = await waitForExit(fg.jobId)
    expect(fgResult.status).toBe('killed')

    const summaries = listShellJobs(session.sessionId)
    const bgSummary = summaries.find((job) => job.jobId === bg.jobId)
    expect(bgSummary?.status).toBe('running')

    killShellJob(bg.jobId, session.sessionId)
    await waitForExit(bg.jobId)
  })
})

describe('output ring', () => {
  test('keeps absolute offsets across head drops', () => {
    const ring = new OutputRing()
    ring.append('a'.repeat(600_000))
    ring.append('b'.repeat(600_000))

    const read = ring.read(0)
    expect(read.start).toBeGreaterThan(0) // head dropped
    expect(read.end).toBe(1_200_000)
    expect(read.text.length).toBe(read.end - read.start)
    expect(read.text.endsWith('b')).toBe(true)

    const tail = ring.read(1_199_990)
    expect(tail.start).toBe(1_199_990)
    expect(tail.text).toBe('b'.repeat(10))
  })

  test('subscribe replays a snapshot then streams live appends', () => {
    const ring = new OutputRing()
    ring.append('abc')

    const seen: string[] = []
    const { initial, unsubscribe } = ring.subscribe(0, (c) => seen.push(c))
    expect(initial.text).toBe('abc')
    expect(initial.end).toBe(3)

    ring.append('def')
    ring.append('ghi')
    // No gap and no duplicate of the replayed snapshot.
    expect(seen).toEqual(['def', 'ghi'])

    unsubscribe()
    ring.append('xyz')
    expect(seen).toEqual(['def', 'ghi'])
  })

  test('subscribe from a mid offset snapshots only the tail', () => {
    const ring = new OutputRing()
    ring.append('hello world')

    const { initial } = ring.subscribe(6, () => {})
    expect(initial.text).toBe('world')
    expect(initial.start).toBe(6)
    expect(initial.end).toBe(11)
  })

  test('head-trim keeps a live subscriber contiguous but clamps new ones', () => {
    const ring = new OutputRing()
    const live: string[] = []
    ring.append('a'.repeat(600_000))
    ring.subscribe(0, (c) => live.push(c))

    ring.append('b'.repeat(600_000)) // 1.2M > 1M cap → head trimmed

    // The live subscriber saw the whole appended chunk, uninterrupted.
    expect(live).toHaveLength(1)
    expect(live[0].length).toBe(600_000)

    // A fresh subscriber from 0 is clamped to the retained tail.
    const { initial } = ring.subscribe(0, () => {})
    expect(initial.start).toBeGreaterThan(0)
    expect(initial.end).toBe(1_200_000)
  })
})

async function drainStream(stream: ShellJobStream) {
  const events: ShellStreamEvent[] = []
  let text = stream.initial.chunk

  if (!stream.registered || stream.status !== 'running') {
    stream.unsubscribe()
    return { text, status: stream.status, exitCode: stream.exitCode, events }
  }

  let status: ShellJobStatus = stream.status
  let exitCode = stream.exitCode
  try {
    for await (const event of stream.events) {
      events.push(event)
      if (event.type === 'chunk') text += event.text
      if (event.type === 'end') {
        status = event.status
        exitCode = event.exitCode
        break
      }
    }
  } finally {
    stream.unsubscribe()
  }
  return { text, status, exitCode, events }
}

describe('job stream', () => {
  test('streams live output then a terminal end event', async () => {
    const { jobId } = await start('echo stream-hello')
    const stream = subscribeShellJob(jobId, session.sessionId, 0)

    const result = await drainStream(stream)
    expect(result.text).toContain('stream-hello')
    expect(result.status).toBe('done')
    expect(result.exitCode).toBe(0)
  })

  test('late subscribe after exit replays buffered output and ends immediately', async () => {
    const { jobId } = await start('echo done-late')
    await waitForExit(jobId)

    const stream = subscribeShellJob(jobId, session.sessionId, 0)
    expect(stream.registered).toBe(false)
    expect(stream.status).not.toBe('running')
    expect(stream.initial.chunk).toContain('done-late')

    const result = await drainStream(stream)
    expect(result.events).toHaveLength(0) // terminal comes from the snapshot
    expect(result.status).toBe('done')
  })

  test('emits a meta event when a running job is backgrounded', async () => {
    const { jobId } = await start('sleep 30')
    const stream = subscribeShellJob(jobId, session.sessionId, 0)
    expect(stream.status).toBe('running')

    backgroundShellJob(jobId, session.sessionId)
    const first = await stream.events.next()
    expect(first.value).toEqual({ type: 'meta', background: true })

    stream.unsubscribe()
    killShellJob(jobId, session.sessionId)
    await waitForExit(jobId)
  })

  test('rejects a stream from the wrong session', async () => {
    const { jobId } = await start('echo x')
    expect(() => subscribeShellJob(jobId, 'other-session', 0)).toThrow(
      'not found',
    )
    await waitForExit(jobId)
  })
})

async function readSseFrames(response: Response) {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const frames: { event: string; data: string }[] = []
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const frame = parseSse(raw)
        if (!frame) continue
        frames.push(frame)
        if (frame.event === 'end') return frames
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return frames
}

function parseSse(raw: string): { event: string; data: string } | null {
  let event = 'message'
  const data: string[] = []
  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) continue
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:'))
      data.push(line.slice(5).replace(/^ /, ''))
  }
  return data.length ? { event, data: data.join('\n') } : null
}

describe('GET /shell/stream route', () => {
  test('streams SSE chunk and end events for a job', async () => {
    const shellRoutes = await getShellRoutes()
    const { jobId } = await start('echo route-hello')
    const response = await shellRoutes.request(
      `/stream?sessionId=${session.sessionId}&jobId=${jobId}&offset=0`,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const frames = await readSseFrames(response)
    const text = frames
      .filter((f) => f.event === 'chunk')
      .map((f) => (JSON.parse(f.data) as { text: string }).text)
      .join('')
    expect(text).toContain('route-hello')
    expect(frames.at(-1)?.event).toBe('end')
    expect((JSON.parse(frames.at(-1)!.data) as { status: string }).status).toBe(
      'done',
    )
  })

  test('returns 404 for an unknown job', async () => {
    const shellRoutes = await getShellRoutes()
    const response = await shellRoutes.request(
      `/stream?sessionId=${session.sessionId}&jobId=nope&offset=0`,
    )
    expect(response.status).toBe(404)
  })

  test('ends the stream at maxBytes without a terminal event (recycle)', async () => {
    const shellRoutes = await getShellRoutes()
    const { jobId } = await start(
      'for i in $(seq 1 300); do echo "row-$i-xxxxxxxxxxxxxxxxxxxx"; done; sleep 5',
    )
    await Bun.sleep(300) // let output buffer past the budget while still running

    const response = await shellRoutes.request(
      `/stream?sessionId=${session.sessionId}&jobId=${jobId}&offset=0&maxBytes=200`,
    )
    expect(response.status).toBe(200)

    const frames = await readSseFrames(response)
    // The job is still running, so a clean close with no `end` is a budget recycle.
    expect(frames.some((f) => f.event === 'chunk')).toBe(true)
    expect(frames.some((f) => f.event === 'end')).toBe(false)

    killShellJob(jobId, session.sessionId)
    await waitForExit(jobId)
  })
})

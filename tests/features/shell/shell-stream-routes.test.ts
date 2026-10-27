import {
  backgroundShellJob,
  killShellJob,
  pollShellJob,
  subscribeShellJob,
} from '@sb/sidecar/shell/registry'
import { describe, expect, test } from 'bun:test'
import {
  drainStream,
  getShellRoutes,
  readSseFrames,
  session,
  start,
  waitFor,
  waitForExit,
} from '~/tests/helpers/shell-registry'

process.env.CHAT_JOB_MODE = 'script'

process.env.CHAT_SIDECAR_DATA_DIR ??= process.cwd()

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
    expect(first.value).toEqual({
      type: 'meta',
      background: true,
      waiting: false,
    })

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

describe('GET /shell/stream route', () => {
  test('streams SSE chunk and end events for a job', async () => {
    const shellRoutes = await getShellRoutes()
    const { jobId } = await start('echo route-hello')
    const response = await shellRoutes.request(
      `/shell/stream?sessionId=${session.sessionId}&jobId=${jobId}&offset=0`,
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
      `/shell/stream?sessionId=${session.sessionId}&jobId=nope&offset=0`,
    )
    expect(response.status).toBe(404)
  })

  test('ends the stream at maxBytes without a terminal event (recycle)', async () => {
    const shellRoutes = await getShellRoutes()
    const { jobId } = await start(
      'for i in $(seq 1 300); do echo "row-$i-xxxxxxxxxxxxxxxxxxxx"; done; sleep 5',
    )
    await waitFor(
      () => pollShellJob(jobId, session.sessionId, 0).chunk.length > 200,
    )

    const response = await shellRoutes.request(
      `/shell/stream?sessionId=${session.sessionId}&jobId=${jobId}&offset=0&maxBytes=200`,
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

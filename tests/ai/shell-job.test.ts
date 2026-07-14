/// <reference types="bun-types" />
import {
  executeShellJob,
  executeShellOutput,
  killShell,
  shellFailure,
  shellHistoryTools,
  shellToModelOutput,
  stripTerminalCodes,
} from '@sb/convex/model/tool/shell'
import type { ShellToolOutput } from '@sb/convex/types'
import { describe, expect, test } from 'bun:test'

const context = { sessionId: 'session-1', workspaceId: 'ws-1' }

type Call = { path: string; body: unknown }

type Frame = {
  chunk: string
  status?: 'running' | 'done' | 'killed' | 'timeout'
  exitCode?: number | null
  background?: boolean
}

type SseEvent = { event: string; data: string }

/** Expands frames into the SSE events the sidecar route would emit. */
function framesToEvents(frames: Frame[]): SseEvent[] {
  const events: SseEvent[] = []
  let offset = 0
  for (const frame of frames) {
    if (frame.chunk) {
      offset += frame.chunk.length
      events.push({
        event: 'chunk',
        data: JSON.stringify({ text: frame.chunk, nextOffset: offset }),
      })
    }
    if (frame.background) {
      events.push({ event: 'meta', data: JSON.stringify({ background: true }) })
    }
    if (frame.status && frame.status !== 'running') {
      events.push({
        event: 'end',
        data: JSON.stringify({
          status: frame.status,
          exitCode: frame.exitCode ?? null,
        }),
      })
    }
  }
  return events
}

function abortError(): Error {
  return Object.assign(new Error('The operation was aborted'), {
    name: 'AbortError',
  })
}

function waitForAbort(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (!signal) return
    if (signal.aborted) return resolve()
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

/**
 * Sidecar stub: `openStream` replays a single connection's SSE events. When
 * the frames never terminate, the stream stays open until aborted (mirroring
 * a live job), so the deadline / abort paths can drive teardown.
 */
function mockSidecar(frames: Frame[]) {
  const calls: Call[] = []
  let streamCount = 0

  const post = async <T>(path: string, body: unknown): Promise<T> => {
    calls.push({ path, body })
    if (path === '/shell/start') return { jobId: 'job-1', mode: 'pipe' } as T
    if (path === '/shell/kill') return { ok: true } as T
    throw new Error(`Unexpected path ${path}`)
  }

  async function* openStream(
    _path: string,
    _query: Record<string, string>,
    signal?: AbortSignal,
  ): AsyncGenerator<SseEvent> {
    streamCount += 1
    const events = framesToEvents(frames)
    for (const event of events) {
      if (signal?.aborted) throw abortError()
      yield event
    }
    // No terminal event scripted: keep the connection open until torn down.
    if (!events.some((e) => e.event === 'end')) {
      await waitForAbort(signal)
      throw abortError()
    }
  }

  return { post, openStream, calls, streams: () => streamCount }
}

async function collect(generator: AsyncGenerator<ShellToolOutput>) {
  const outputs: ShellToolOutput[] = []
  for await (const output of generator) outputs.push(output)
  return outputs
}

const fast = { pollIntervalMs: 1 }

describe('executeShellJob', () => {
  test('streams preliminary terminal output and a final text', async () => {
    const { post, openStream, calls } = mockSidecar([
      { chunk: 'hello ' },
      { chunk: 'world\n' },
      { chunk: '', status: 'done', exitCode: 0 },
    ])

    const outputs = await collect(
      executeShellJob(
        context,
        { command: 'echo hi' },
        { ...fast, post, openStream },
      ),
    )

    expect(calls[0]).toEqual({
      path: '/shell/start',
      body: {
        sessionId: 'session-1',
        workspaceId: 'ws-1',
        command: 'echo hi',
        timeoutSeconds: undefined,
        background: undefined,
      },
    })

    const running = outputs.slice(0, -1)
    expect(running.every((o) => o.status === 'running')).toBe(true)
    expect(running.every((o) => o.text === '')).toBe(true)
    expect(running.at(-1)?.term).toBe('hello world\n')

    const final = outputs.at(-1)
    expect(final?.status).toBe('done')
    expect(final?.exitCode).toBe(0)
    expect(final?.text).toBe('hello world')
    expect(final?.term).toBe('hello world\n')
  })

  test('frames non-zero exit codes as data, not errors', async () => {
    const { post, openStream } = mockSidecar([
      { chunk: 'boom\n', status: 'done', exitCode: 3 },
    ])

    const outputs = await collect(
      executeShellJob(
        context,
        { command: 'exit 3' },
        { ...fast, post, openStream },
      ),
    )

    expect(outputs.at(-1)?.text).toBe('boom\n(exit code 3)')
    expect(outputs.at(-1)?.exitCode).toBe(3)
  })

  test('background jobs yield once and return immediately', async () => {
    const { post, openStream, streams } = mockSidecar([])

    const outputs = await collect(
      executeShellJob(
        context,
        { command: 'sleep 100', run_in_background: true },
        { ...fast, post, openStream },
      ),
    )

    expect(outputs).toHaveLength(1)
    expect(outputs[0].status).toBe('background')
    expect(outputs[0].text).toContain('job-1')
    expect(streams()).toBe(0)
  })

  test('detaches a foreground job once it is sent to the background', async () => {
    const { post, openStream } = mockSidecar([
      { chunk: 'working ' },
      { chunk: 'more\n', background: true },
      { chunk: '', status: 'done', exitCode: 0 },
    ])

    const outputs = await collect(
      executeShellJob(
        context,
        { command: 'sleep 100' },
        { ...fast, post, openStream },
      ),
    )

    const final = outputs.at(-1)
    // Detaches at the background meta event; never reaches the 'done' event.
    expect(final?.status).toBe('background')
    expect(final?.text).toContain('still running')
  })

  test('kills the job and finalizes when aborted', async () => {
    const { post, openStream, calls } = mockSidecar([{ chunk: 'partial' }])
    const controller = new AbortController()

    const generator = executeShellJob(
      context,
      { command: 'sleep 100' },
      { ...fast, post, openStream, abortSignal: controller.signal },
    )

    const first = await generator.next()
    expect((first.value as ShellToolOutput).status).toBe('running')

    controller.abort()
    const outputs = await collect(generator)

    expect(calls.some((c) => c.path === '/shell/kill')).toBe(true)
    expect(outputs.at(-1)?.status).toBe('killed')
    expect(outputs.at(-1)?.text).toContain('(command was killed)')
  })

  test('throws after repeated stream failures', async () => {
    const post = async <T>(path: string): Promise<T> => {
      if (path === '/shell/start') return { jobId: 'job-1', mode: 'pipe' } as T
      return { ok: true } as T
    }
    // eslint-disable-next-line require-yield
    const openStream = async function* (): AsyncGenerator<SseEvent> {
      throw new Error('connection refused')
    }

    await expect(
      collect(
        executeShellJob(
          context,
          { command: 'ls' },
          { ...fast, post, openStream },
        ),
      ),
    ).rejects.toThrow('connection refused')
  })

  test('reports lost jobs when the sidecar forgot them', async () => {
    const post = async <T>(path: string): Promise<T> => {
      if (path === '/shell/start') return { jobId: 'job-1', mode: 'pipe' } as T
      return { ok: true } as T
    }
    // eslint-disable-next-line require-yield
    const openStream = async function* (): AsyncGenerator<SseEvent> {
      throw new Error('Job not found for this session')
    }

    const outputs = await collect(
      executeShellJob(
        context,
        { command: 'ls' },
        { ...fast, post, openStream },
      ),
    )
    expect(outputs.at(-1)?.status).toBe('lost')
  })
})

describe('executeShellOutput', () => {
  test('returns current output when the job is still running', async () => {
    const { post, openStream } = mockSidecar([{ chunk: 'working...\n' }])

    const outputs = await collect(
      executeShellOutput(
        context,
        { jobId: 'job-1', wait_seconds: 0 },
        { ...fast, post, openStream },
      ),
    )

    const final = outputs.at(-1)
    expect(final?.status).toBe('background')
    expect(final?.text).toContain('working...')
    expect(final?.text).toContain('still running')
  })

  test('waits for completion within the deadline', async () => {
    const { post, openStream } = mockSidecar([
      { chunk: 'step 1\n' },
      { chunk: 'done\n', status: 'done', exitCode: 0 },
    ])

    const outputs = await collect(
      executeShellOutput(
        context,
        { jobId: 'job-1', wait_seconds: 5 },
        { ...fast, post, openStream },
      ),
    )

    expect(outputs.at(-1)?.status).toBe('done')
    expect(outputs.at(-1)?.text).toBe('step 1\ndone')
  })
})

describe('killShell', () => {
  test('posts a kill for the session', async () => {
    const { post, calls } = mockSidecar([])
    const result = await killShell(context, 'job-9', post)

    expect(result).toBe('Killed job job-9')
    expect(calls).toEqual([
      { path: '/shell/kill', body: { sessionId: 'session-1', jobId: 'job-9' } },
    ])
  })
})

describe('model output mapping', () => {
  const output: ShellToolOutput = {
    jobId: 'job-1',
    status: 'done',
    exitCode: 0,
    text: 'plain output',
    term: '\u001b[31mplain output\u001b[0m',
    termOffset: 0,
  }

  test('emits text only, never the terminal tail', () => {
    expect(shellToModelOutput({ output })).toEqual({
      type: 'text',
      value: 'plain output',
    })
  })

  test('summarizes preliminary running outputs', () => {
    const value = shellToModelOutput({
      output: { ...output, status: 'running', text: '' },
    })
    expect(value).toEqual({
      type: 'text',
      value: '(command is still running, job job-1)',
    })
  })

  test('passes through legacy string outputs', () => {
    const output = 'Tool failed: nope' as unknown as ShellToolOutput
    expect(shellToModelOutput({ output })).toEqual({
      type: 'text',
      value: 'Tool failed: nope',
    })
  })

  test('provides history mappers for shell and shell_output', () => {
    const tools = shellHistoryTools()
    expect(Object.keys(tools)).toEqual(['shell', 'shell_output'])
    expect(tools.shell.toModelOutput).toBeDefined()
  })
})

describe('shellFailure', () => {
  test('yields a single failed output', async () => {
    const outputs = await collect(shellFailure('nope'))
    expect(outputs).toHaveLength(1)
    expect(outputs[0].text).toBe('Tool failed: nope')
  })
})

describe('stripTerminalCodes', () => {
  test('removes ANSI color and OSC sequences', () => {
    expect(
      stripTerminalCodes('\u001b[1;31mred\u001b[0m \u001b]0;title\u0007text'),
    ).toBe('red text')
  })

  test('resolves carriage-return overwrites', () => {
    expect(stripTerminalCodes('progress 10%\rprogress 100%\ndone')).toBe(
      'progress 100%\ndone',
    )
    expect(stripTerminalCodes('long line\rok\n')).toBe('okng line\n')
  })

  test('normalizes pty line endings', () => {
    expect(stripTerminalCodes('a\r\nb\r\n')).toBe('a\nb\n')
  })
})

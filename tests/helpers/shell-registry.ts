import {
  type ShellJobStatus,
  type ShellJobStream,
  type ShellStreamEvent,
  pollShellJob,
  startShellJob,
} from '@sb/sidecar/shell/registry'

/** Lazy import: routes pull in workspace, which needs the data dir set above. */
export async function getShellRoutes() {
  const { createApp } = await import('@sb/sidecar/main')
  return createApp(async (_c, next) => next())
}

export const session = { sessionId: 'session-1', workspaceId: 'ws-1' }

export function start(command: string, overrides?: Record<string, unknown>) {
  return startShellJob({
    ...session,
    command,
    cwd: process.cwd(),
    ...overrides,
  })
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function waitFor(condition: () => boolean, timeoutMs = 6_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return
    await Bun.sleep(100)
  }
  throw new Error('Condition not met in time')
}

export async function waitForExit(jobId: string, timeoutMs = 10_000) {
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

/** Waits until a long-running shell has actually started before testing cleanup. */
export async function startReady(overrides?: Record<string, unknown>) {
  const job = await start('echo fixture-ready; sleep 30', overrides)
  await waitFor(() =>
    pollShellJob(job.jobId, session.sessionId, 0).chunk.includes(
      'fixture-ready',
    ),
  )
  return job
}

export async function drainStream(stream: ShellJobStream) {
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

export async function readSseFrames(response: Response) {
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

export function parseSse(raw: string): { event: string; data: string } | null {
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

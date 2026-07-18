import { probeStdinWait, scanAltScreen } from './interactive'
import { type PtyMode, type ShellJobProcess, spawnJob } from './pty'

const MAX_BUFFER_CHARS = 1_000_000
const MAX_RUNNING_PER_SESSION = 8
const DEFAULT_FOREGROUND_TIMEOUT_S = 120
const MAX_TIMEOUT_S = 1800
const FINISHED_JOB_TTL_MS = 30 * 60 * 1000
const SWEEP_INTERVAL_MS = 60 * 1000
const EXIT_FLUSH_MS = 50
const WAIT_PROBE_MS = 700

export type ShellJobStatus = 'running' | 'done' | 'killed' | 'timeout'

export type StartShellJobInput = {
  sessionId: string
  workspaceId: string
  command: string
  cwd: string
  timeoutSeconds?: number
  background?: boolean
  cols?: number
  rows?: number
}

export type ShellJobSummary = {
  jobId: string
  command: string
  status: ShellJobStatus
  exitCode: number | null
  background: boolean
  waiting: boolean
  startedAt: number
  exitedAt?: number
  mode: PtyMode
}

export type PollResult = {
  chunk: string
  nextOffset: number
  bufferStart: number
  status: ShellJobStatus
  exitCode: number | null
  background: boolean
  waiting: boolean
}

type ChunkListener = (chunk: string) => void

export type RingSnapshot = { text: string; start: number; end: number }

export type RingSubscription = {
  initial: RingSnapshot
  unsubscribe: () => void
}

/**
 * Scrollback buffer addressed by absolute character offsets to let readers
 * detect gaps after the head is dropped.
 */
export class OutputRing {
  private buffer = ''
  private startOffset = 0
  private listeners = new Set<ChunkListener>()

  append(text: string) {
    this.buffer += text
    if (this.buffer.length > MAX_BUFFER_CHARS) {
      const drop = this.buffer.length - MAX_BUFFER_CHARS
      this.buffer = this.buffer.slice(drop)
      this.startOffset += drop
    }
    for (const listener of this.listeners) listener(text)
  }

  read(from: number): RingSnapshot {
    const start = Math.max(from, this.startOffset)
    return {
      text: this.buffer.slice(start - this.startOffset),
      start,
      end: this.startOffset + this.buffer.length,
    }
  }

  subscribe(from: number, onChunk: ChunkListener): RingSubscription {
    const initial = this.read(from)
    this.listeners.add(onChunk)
    return { initial, unsubscribe: () => this.listeners.delete(onChunk) }
  }
}

export type ShellStreamEvent =
  | { type: 'chunk'; text: string; nextOffset: number }
  | { type: 'meta'; background: boolean; waiting: boolean }
  | { type: 'end'; status: ShellJobStatus; exitCode: number | null }

/** Buffers a shell's live output/status into an async iterator for the SSE route. */
export class ShellJobSubscriber {
  private pendingChunk = ''
  private pendingMeta: { background: boolean; waiting: boolean } | null = null
  private ended: { status: ShellJobStatus; exitCode: number | null } | null =
    null
  private wake: (() => void) | null = null
  private cancelled = false

  constructor(private offset: number) {}

  readonly onChunk = (chunk: string) => {
    this.pendingChunk += chunk
    this.signal()
  }

  onMeta(background: boolean, waiting: boolean) {
    this.pendingMeta = { background, waiting }
    this.signal()
  }

  onEnd(status: ShellJobStatus, exitCode: number | null) {
    this.ended = { status, exitCode }
    this.signal()
  }

  cancel() {
    this.cancelled = true
    this.signal()
  }

  private signal() {
    if (this.wake) {
      const wake = this.wake
      this.wake = null
      wake()
    }
  }

  async *events(): AsyncGenerator<ShellStreamEvent> {
    while (true) {
      if (this.pendingChunk) {
        const text = this.pendingChunk
        this.pendingChunk = ''
        this.offset += text.length
        yield { type: 'chunk', text, nextOffset: this.offset }
        continue
      }
      if (this.pendingMeta) {
        const { background, waiting } = this.pendingMeta
        this.pendingMeta = null
        yield { type: 'meta', background, waiting }
        continue
      }
      if (this.ended) {
        yield { type: 'end', ...this.ended }
        return
      }
      if (this.cancelled) return
      await new Promise<void>((resolve) => (this.wake = resolve))
    }
  }
}

type ShellJob = {
  jobId: string
  sessionId: string
  workspaceId: string
  command: string
  proc: ShellJobProcess
  ring: OutputRing
  status: ShellJobStatus
  endReason?: 'killed' | 'timeout'
  exitCode: number | null
  background: boolean
  /** Job is waiting on terminal input (blocked stdin read or alt screen). */
  waiting: boolean
  stdinWait: boolean
  altScreen: boolean
  altCarry: string
  waitProbe?: ReturnType<typeof setInterval>
  startedAt: number
  exitedAt?: number
  timeoutTimer: ReturnType<typeof setTimeout>
  subscribers: Set<ShellJobSubscriber>
}

const jobs = new Map<string, ShellJob>()
let sweeper: ReturnType<typeof setInterval> | undefined
let jobCounter = 0

function nextJobId(): string {
  return `shell-${++jobCounter}`
}

function ensureSweeper() {
  if (sweeper) return
  sweeper = setInterval(() => {
    const now = Date.now()
    for (const [jobId, job] of jobs) {
      if (job.exitedAt && now - job.exitedAt > FINISHED_JOB_TTL_MS) {
        jobs.delete(jobId)
      }
    }
  }, SWEEP_INTERVAL_MS)
  sweeper.unref?.()
}

function runningSessionJobs(sessionId: string): ShellJob[] {
  return [...jobs.values()].filter(
    (job) => job.sessionId === sessionId && job.status === 'running',
  )
}

export async function startShellJob(
  input: StartShellJobInput,
): Promise<{ jobId: string; mode: PtyMode }> {
  if (runningSessionJobs(input.sessionId).length >= MAX_RUNNING_PER_SESSION) {
    throw new Error(
      `Too many running jobs for this session (max ${MAX_RUNNING_PER_SESSION})`,
    )
  }

  const proc = await spawnJob({
    command: input.command,
    cwd: input.cwd,
    cols: input.cols ?? 80,
    rows: input.rows ?? 24,
  })

  const timeoutSeconds = Math.min(
    input.timeoutSeconds ??
      (input.background ? MAX_TIMEOUT_S : DEFAULT_FOREGROUND_TIMEOUT_S),
    MAX_TIMEOUT_S,
  )

  const job: ShellJob = {
    jobId: nextJobId(),
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    command: input.command,
    proc,
    ring: new OutputRing(),
    status: 'running',
    exitCode: null,
    background: input.background ?? false,
    waiting: false,
    stdinWait: false,
    altScreen: false,
    altCarry: '',
    startedAt: Date.now(),
    subscribers: new Set(),
    timeoutTimer: setTimeout(() => {
      if (job.status !== 'running') return
      job.endReason = 'timeout'
      proc.kill()
    }, timeoutSeconds * 1000),
  }

  proc.onData((chunk) => {
    job.ring.append(chunk)
    trackAltScreen(job, chunk)
  })

  startWaitProbe(job)

  proc.onExit((exitCode) => {
    // Grace period after exit for the final output
    setTimeout(() => {
      clearInterval(job.waitProbe)
      clearTimeout(job.timeoutTimer)
      job.exitCode = exitCode
      job.exitedAt = Date.now()
      job.waiting = false
      if (job.status === 'running') job.status = job.endReason ?? 'done'
      for (const sub of job.subscribers) sub.onEnd(job.status, job.exitCode)
      job.subscribers.clear()
    }, EXIT_FLUSH_MS)
  })

  jobs.set(job.jobId, job)
  ensureSweeper()
  return { jobId: job.jobId, mode: proc.mode }
}

/**
 * Periodically probes /proc for a blocked stdin read while the job runs.
 * Skipped in pipe mode, where there is no pty to wait on.
 */
function startWaitProbe(job: ShellJob) {
  const pid = job.proc.pid
  if (pid === undefined || job.proc.mode === 'pipe') return
  job.waitProbe = setInterval(() => {
    if (job.status !== 'running') return
    const stdinWait = probeStdinWait(pid)
    if (stdinWait === job.stdinWait) return
    job.stdinWait = stdinWait
    updateWaiting(job)
  }, WAIT_PROBE_MS)
  job.waitProbe.unref?.()
}

function trackAltScreen(job: ShellJob, chunk: string) {
  const scanned = scanAltScreen(job.altCarry + chunk, job.altScreen)
  job.altCarry = scanned.carry
  if (scanned.active === job.altScreen) return
  job.altScreen = scanned.active
  updateWaiting(job)
}

function updateWaiting(job: ShellJob) {
  const waiting = job.status === 'running' && (job.stdinWait || job.altScreen)
  if (waiting === job.waiting) return
  job.waiting = waiting
  for (const sub of job.subscribers) sub.onMeta(job.background, waiting)
}

function requireJob(jobId: string, sessionId: string): ShellJob {
  const job = jobs.get(jobId)
  if (!job || job.sessionId !== sessionId) {
    throw new Error('Job not found for this session')
  }
  return job
}

export function pollShellJob(
  jobId: string,
  sessionId: string,
  offset: number,
): PollResult {
  const job = requireJob(jobId, sessionId)
  const { text, start, end } = job.ring.read(offset)
  return {
    chunk: text,
    nextOffset: end,
    bufferStart: start,
    status: job.status,
    exitCode: job.exitCode,
    background: job.background,
    waiting: job.waiting,
  }
}

export type ShellJobStream = {
  initial: { chunk: string; nextOffset: number; bufferStart: number }
  status: ShellJobStatus
  exitCode: number | null
  background: boolean
  waiting: boolean
  registered: boolean // false when the job already ended
  events: AsyncGenerator<ShellStreamEvent>
  unsubscribe: () => void
}

/**
 * Snapshots from `offset` and, if the job is still running, attaches live
 * output/status listeners in one synchronous block (no interleave with the
 * exit transition or an append).
 */
export function subscribeShellJob(
  jobId: string,
  sessionId: string,
  offset: number,
): ShellJobStream {
  const job = requireJob(jobId, sessionId)
  const sub = new ShellJobSubscriber(job.ring.read(offset).end)
  const registered = job.status === 'running'
  const { initial, unsubscribe: unsubRing } = job.ring.subscribe(
    offset,
    sub.onChunk,
  )
  if (registered) job.subscribers.add(sub)

  return {
    initial: {
      chunk: initial.text,
      nextOffset: initial.end,
      bufferStart: initial.start,
    },
    status: job.status,
    exitCode: job.exitCode,
    background: job.background,
    waiting: job.waiting,
    registered,
    events: sub.events(),
    unsubscribe: () => {
      unsubRing()
      job.subscribers.delete(sub)
      sub.cancel()
    },
  }
}

/** Detaches a running job so it survives stream cleanup and watchers stop blocking. */
export function backgroundShellJob(jobId: string, sessionId: string) {
  const job = requireJob(jobId, sessionId)
  if (job.status !== 'running') return
  job.background = true
  for (const sub of job.subscribers) sub.onMeta(true, job.waiting)
}

export function writeStdin(jobId: string, sessionId: string, data: string) {
  const job = requireJob(jobId, sessionId)
  if (job.status !== 'running') throw new Error('Job is not running')
  job.proc.write(data)
}

export function killShellJob(jobId: string, sessionId: string) {
  const job = requireJob(jobId, sessionId)
  if (job.status !== 'running') return
  job.endReason = 'killed'
  job.proc.kill()
}

export function resizeShellJob(
  jobId: string,
  sessionId: string,
  cols: number,
  rows: number,
) {
  const job = requireJob(jobId, sessionId)
  job.proc.resize(cols, rows)
}

export function listShellJobs(sessionId: string): ShellJobSummary[] {
  return [...jobs.values()]
    .filter((job) => job.sessionId === sessionId)
    .map((job) => ({
      jobId: job.jobId,
      command: job.command,
      status: job.status,
      exitCode: job.exitCode,
      background: job.background,
      waiting: job.waiting,
      startedAt: job.startedAt,
      exitedAt: job.exitedAt,
      mode: job.proc.mode,
    }))
}

export function killSessionShellJobs(
  sessionId: string,
  includeBackground: boolean,
): number {
  const targets = runningSessionJobs(sessionId).filter(
    (job) => includeBackground || !job.background,
  )
  for (const job of targets) {
    job.endReason = 'killed'
    job.proc.kill()
  }
  return targets.length
}

export function killSessionForegroundShellJobs(sessionId: string): number {
  return killSessionShellJobs(sessionId, false)
}

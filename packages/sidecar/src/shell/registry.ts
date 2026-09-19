import { startWaitProbe } from './job-interaction'
import { trackAltScreen } from './job-interaction'
import { type ShellJobStatus } from './job-protocol'
import { type StartShellJobInput } from './job-protocol'
import { type ShellJobSummary } from './job-protocol'
import { type PollResult } from './job-protocol'
import { type ShellStreamEvent } from './job-protocol'
import { type ShellJob } from './job-state'
import { OutputRing } from './output-ring'
import { type PtyMode, spawnJob } from './pty'
import { ShellJobSubscriber } from './subscriber'

export type { ShellJobStatus } from './job-protocol'
export type { StartShellJobInput } from './job-protocol'
export type { ShellJobSummary } from './job-protocol'
export type { PollResult } from './job-protocol'
export type { RingSnapshot } from './output-ring'
export type { RingSubscription } from './output-ring'
export { OutputRing } from './output-ring'
export type { ShellStreamEvent } from './job-protocol'
export { ShellJobSubscriber } from './subscriber'

const MAX_RUNNING_PER_SESSION = 8

const DEFAULT_FOREGROUND_TIMEOUT_S = 120

const MAX_TIMEOUT_S = 1800

const FINISHED_JOB_TTL_MS = 30 * 60 * 1000

const SWEEP_INTERVAL_MS = 60 * 1000

const EXIT_FLUSH_MS = 50

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
    shell: input.shell,
  })

  const timeoutMs = resolveTimeoutMs(input)

  const job: ShellJob = {
    jobId: nextJobId(),
    sessionId: input.sessionId,
    owner: input.owner,
    messageId: input.messageId,
    messageCreatedAt: input.messageCreatedAt,
    toolCallId: input.toolCallId,
    workspaceId: input.workspaceId,
    command: input.command,
    proc,
    ring: new OutputRing(),
    status: 'running',
    exitCode: null,
    background: input.background ?? false,
    allowInteractiveShells: input.allowInteractiveShells ?? false,
    waiting: false,
    stdinWait: false,
    altScreen: false,
    altCarry: '',
    startedAt: Date.now(),
    subscribers: new Set(),
    timeoutTimer:
      timeoutMs === null
        ? undefined
        : setTimeout(() => {
            if (job.status !== 'running') return
            job.endReason = 'timeout'
            proc.kill()
          }, timeoutMs),
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

/** `timeoutSeconds: 0` runs the job until it exits or is killed. */
function resolveTimeoutMs(input: StartShellJobInput): number | null {
  if (input.timeoutSeconds === 0) return null
  const seconds = Math.min(
    input.timeoutSeconds ??
      (input.background ? MAX_TIMEOUT_S : DEFAULT_FOREGROUND_TIMEOUT_S),
    MAX_TIMEOUT_S,
  )
  return seconds * 1000
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
      messageId: job.messageId,
      messageCreatedAt: job.messageCreatedAt,
      toolCallId: job.toolCallId,
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

/** `owner` narrows the sweep to the jobs one turn started. */
export function killSessionShellJobs(
  sessionId: string,
  includeBackground: boolean,
  owner?: string,
): number {
  const targets = runningSessionJobs(sessionId).filter(
    (job) =>
      (includeBackground || !job.background) &&
      (owner === undefined || job.owner === owner),
  )
  for (const job of targets) {
    job.endReason = 'killed'
    job.proc.kill()
  }
  return targets.length
}

import type { ShellJobSummary } from '@sb/core/types/tools'

export type ListShellJobs = (args: {
  sessionId: string
}) => Promise<{ jobs: ShellJobSummary[] }>

const POLL_INTERVAL_MS = 2500

const listeners = new Set<() => void>()
/** Jobs optimistically hidden until the sidecar stops reporting them. */
const dropped = new Set<string>()

export const NO_JOBS: ShellJobSummary[] = []

let jobs = NO_JOBS
let subscribers = 0
let activeSession: string | null = null
let listJobs: ListShellJobs | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let generation = 0

export function getShellJobs(): ShellJobSummary[] {
  return jobs
}

export function subscribeToShellJobs(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Hides a job locally, for a kill whose effect has not landed yet. */
export function dropShellJob(jobId: string) {
  dropped.add(jobId)
  publish(jobs.filter((job) => job.jobId !== jobId))
}

/**
 * Starts (or joins) polling for `sessionId`. Polling stops once the last
 * consumer releases it via the returned release function.
 */
export function retainShellJobs(
  sessionId: string | null,
  list: ListShellJobs,
): () => void {
  if (!sessionId) return () => {}

  listJobs = list
  subscribers += 1

  // Joining an already polling session must not restart its timer, or
  // scrolling a list of terminals would poll on every mount
  if (sessionId !== activeSession) {
    reset(sessionId)
    schedule(0)
  } else if (subscribers === 1) {
    schedule(0)
  }

  return () => {
    subscribers -= 1
    if (subscribers <= 0) reset(null)
  }
}

function reset(sessionId: string | null) {
  generation += 1
  clearTimeout(timer)
  activeSession = sessionId
  dropped.clear()
  publish(NO_JOBS)
}

function schedule(delay: number) {
  clearTimeout(timer)
  const current = generation
  timer = setTimeout(() => void poll(current), delay)
}

async function poll(current: number) {
  const sessionId = activeSession
  if (!sessionId || !listJobs || current !== generation) return

  try {
    const result = await listJobs({ sessionId })
    if (current === generation) publish(result.jobs)
  } catch {
    // Keep the last known list
  }
  if (current === generation) schedule(POLL_INTERVAL_MS)
}

function publish(next: ShellJobSummary[]) {
  for (const jobId of dropped) {
    if (!next.some((job) => job.jobId === jobId)) dropped.delete(jobId)
  }

  const visible = next.filter((job) => !dropped.has(job.jobId))
  if (sameJobs(jobs, visible)) return

  jobs = visible.length ? visible : NO_JOBS
  listeners.forEach((listener) => listener())
}

/** Compares what consumers actually render. */
function sameJobs(a: ShellJobSummary[], b: ShellJobSummary[]): boolean {
  return (
    a.length === b.length &&
    a.every((job, index) => {
      const other = b[index]
      return (
        job.jobId === other.jobId &&
        job.status === other.status &&
        job.waiting === other.waiting &&
        job.background === other.background
      )
    })
  )
}

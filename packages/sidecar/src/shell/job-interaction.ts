import { probeStdinWait, scanAltScreen } from './interactive'
import { type ShellJob } from './job-state'

export const WAIT_PROBE_MS = 700

/**
 * Periodically probes /proc for a blocked stdin read while the job runs.
 * Skipped in pipe mode, where there is no pty to wait on.
 */
export function startWaitProbe(job: ShellJob) {
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

export function trackAltScreen(job: ShellJob, chunk: string) {
  const scanned = scanAltScreen(job.altCarry + chunk, job.altScreen)
  job.altCarry = scanned.carry
  if (scanned.active === job.altScreen) return
  job.altScreen = scanned.active
  updateWaiting(job)
}

export const interactiveError =
  '\r\nError: Interactive shells are disabled. This command requires terminal' +
  ' input. Try a non-interactive command instead (for example, supply input' +
  ' or use non-interactive flags).\r\n'

export function updateWaiting(job: ShellJob) {
  const waiting = job.status === 'running' && (job.stdinWait || job.altScreen)
  if (waiting && !job.allowInteractiveShells) {
    if (job.endReason) return
    job.endReason = 'killed'
    job.ring.append(interactiveError)
    job.proc.kill()
    return
  }
  if (waiting === job.waiting) return
  job.waiting = waiting
  for (const sub of job.subscribers) sub.onMeta(job.background, waiting)
}

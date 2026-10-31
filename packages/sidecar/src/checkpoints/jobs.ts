import type { CaptureGroup } from './types'

/** Checks both persisted process identities and jobs owned by this sidecar. */
export async function hasCaptureJobs(group: CaptureGroup) {
  const { listShellJobs } = await import('../shell/registry')
  return (
    (group.shellPids ?? []).some(processAlive) ||
    group.participants.some((participant) =>
      listShellJobs(participant.sessionId).some(
        (job) => job.status === 'running',
      ),
    )
  )
}

function processAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

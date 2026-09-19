import { type ShellStreamEvent } from '../sidecar'

export type RaceResult =
  'heartbeat' | 'deadline' | { result: IteratorResult<ShellStreamEvent> }

/**
 * Waits for the next SSE event, racing a heartbeat tick and the optional
 * wait deadline.
 */
export async function raceNextEvent(
  pending: Promise<IteratorResult<ShellStreamEvent>>,
  lastYield: number,
  deadline: number | undefined,
  heartbeatMs: number,
): Promise<RaceResult> {
  const timers: ReturnType<typeof setTimeout>[] = []
  const contenders: Promise<RaceResult>[] = [
    pending.then((result) => ({ result }) as RaceResult),
    new Promise<RaceResult>((resolve) => {
      const delay = Math.max(0, heartbeatMs - (Date.now() - lastYield))
      timers.push(setTimeout(() => resolve('heartbeat'), delay))
    }),
  ]
  if (deadline) {
    contenders.push(
      new Promise<RaceResult>((resolve) => {
        timers.push(
          setTimeout(
            () => resolve('deadline'),
            Math.max(0, deadline - Date.now()),
          ),
        )
      }),
    )
  }
  try {
    return await Promise.race(contenders)
  } finally {
    timers.forEach(clearTimeout)
  }
}

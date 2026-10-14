'use node'

import { internal } from '../../_generated/api'
import type { ActionCtx } from '../../_generated/server'
import type { StreamExecutionArgs } from '../../types'

export const STEP_DEADLINE_GRACE_MS = 45_000

export const HEARTBEAT_INTERVAL_MS = 60_000

export const STEP_DEADLINE_REASON = 'stream-window-elapsed'

export const STOP_POLL_INTERVAL_MS = 250

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Polls stream status while a provider step is in flight and aborts
 * `abortController` as soon as the stream is stopped. May break
 * usage stats.
 */
export function watchForStop(
  ctx: ActionCtx,
  execution: StreamExecutionArgs,
  abortController: AbortController,
  options?: { deadlineAt?: number },
) {
  let disposed = false
  void (async () => {
    let lastHeartbeat = 0
    while (!disposed && !abortController.signal.aborted) {
      try {
        const active = await ctx.runQuery(internal.streams._isActive, {
          ...execution,
        })
        if (!active) {
          abortController.abort()
          return
        }
        const deadlineElapsed =
          options?.deadlineAt !== undefined && Date.now() >= options.deadlineAt
        if (deadlineElapsed) {
          abortController.abort(STEP_DEADLINE_REASON)
          return
        }
        if (Date.now() - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
          lastHeartbeat = Date.now()
          await ctx.runMutation(internal.streams._heartbeat, execution)
        }
      } catch {
        // Keep polling
      }
      await sleep(STOP_POLL_INTERVAL_MS)
    }
  })()

  return {
    dispose: () => {
      disposed = true
    },
  }
}

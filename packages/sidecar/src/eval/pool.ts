import { EVAL_LIMITS } from '@sb/core/interpreter/limits'
import type {
  EvaluationReply,
  EvaluationRequest,
  EvaluationResult,
} from '@sb/core/interpreter/request'
import { Worker } from 'node:worker_threads'

export class EvaluationBusyError extends Error {
  constructor() {
    super('Dynamic evaluation is busy; please retry')
  }
}

let active = 0
const queue: Array<() => void> = []

/** Bounds concurrent guests and queued requests, including worker startup. */
export async function evaluateInWorker(
  request: EvaluationRequest & { authorizedWorkDir?: string },
): Promise<EvaluationResult> {
  if (active >= EVAL_LIMITS.concurrency) {
    if (queue.length >= EVAL_LIMITS.queueLength) throw new EvaluationBusyError()
    await new Promise<void>((resolve) => queue.push(resolve))
  } else active++
  try {
    return await runWorker(request)
  } finally {
    const next = queue.shift()
    if (next) next()
    else active--
  }
}

function runWorker(
  request: EvaluationRequest & { authorizedWorkDir?: string },
): Promise<EvaluationResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), {
      workerData: request,
      env: {},
      resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
    })
    let settled = false
    const finish = (reply: EvaluationReply) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // Release the concurrency slot only after the guest has actually stopped
      void worker.terminate().finally(() => {
        if (reply.ok) resolve(reply.result)
        else reject(new Error(reply.error))
      })
    }
    const timer = setTimeout(
      () => finish({ ok: false, error: 'Dynamic evaluation timed out' }),
      EVAL_LIMITS.deadlineMs,
    )
    worker.once('message', finish)
    worker.once('error', () =>
      finish({ ok: false, error: 'Dynamic evaluation worker failed' }),
    )
    worker.once('exit', () =>
      finish({ ok: false, error: 'Dynamic evaluation worker stopped' }),
    )
  })
}

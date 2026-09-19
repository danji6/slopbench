import { EVAL_LIMITS } from '@sb/core/interpreter/limits'
import type {
  EvaluationReply,
  EvaluationRequest,
  EvaluationResult,
} from '@sb/core/interpreter/request'

/** Runs a disposable browser guest, terminating it on cancellation or timeout. */
export function evaluateInBrowser(
  request: EvaluationRequest,
  signal?: AbortSignal,
): Promise<EvaluationResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Preview cancelled'))

    const worker = new Worker(
      new URL('../workers/eval.worker.ts', import.meta.url),
      { type: 'module' },
    )

    const finish = (reply: EvaluationReply) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      worker.terminate()
      if (reply.ok) resolve(reply.result)
      else reject(new Error(reply.error))
    }

    const cancel = () => finish({ ok: false, error: 'Preview cancelled' })

    const timer = setTimeout(
      () => finish({ ok: false, error: 'Prompt preview timed out' }),
      EVAL_LIMITS.deadlineMs,
    )

    signal?.addEventListener('abort', cancel, { once: true })
    worker.onmessage = (event: MessageEvent<EvaluationReply>) =>
      finish(event.data)
    worker.onerror = () =>
      finish({ ok: false, error: 'Prompt preview worker failed' })
    worker.postMessage(request)
  })
}

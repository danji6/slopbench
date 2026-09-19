import {
  type EvaluationReply,
  type EvaluationRequest,
  evaluateRequest,
} from '@sb/core/interpreter/request'

self.onmessage = async (event: MessageEvent<EvaluationRequest>) => {
  try {
    const result = await evaluateRequest(event.data)
    self.postMessage({ ok: true, result } satisfies EvaluationReply)
  } catch {
    self.postMessage({
      ok: false,
      error: 'Prompt preview failed or exceeded its resource limit',
    } satisfies EvaluationReply)
  }
}

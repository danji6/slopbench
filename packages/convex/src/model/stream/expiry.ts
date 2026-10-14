import type { Doc } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { cancelScheduledExecution } from './execution'
import { _finalizeStopped, failStream } from './lifecycleTerminal'

/** Settles an expired lease identically from lookup and periodic maintenance. */
export async function expireStream(ctx: MutationCtx, stream: Doc<'streams'>) {
  await cancelScheduledExecution(ctx, stream)
  if (stream.state.phase === 'stopping') {
    await _finalizeStopped(ctx, { streamId: stream._id })
  } else {
    await failStream(ctx, stream, 'Stream interrupted before completion.')
  }
}

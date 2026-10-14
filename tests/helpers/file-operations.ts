import type { Id } from '@sb/convex/_generated/dataModel'
import type { AuthMutationCtx } from '@sb/convex/functions'
import { complete } from '@sb/convex/model/skills/completion'
import { claimExecution } from '@sb/convex/model/skills/execution'
import type { OperationResult } from '@sb/convex/types'

type CompletionInput = {
  operationId: Id<'agentFileOperations'>
  attempt?: number
  path?: string
}

/** Claims the currently scheduled attempt for policy tests. */
export async function claimFileOperation(
  ctx: AuthMutationCtx,
  args: { operationId: Id<'agentFileOperations'> },
) {
  const op = await ctx.db.get(args.operationId)
  if (!op) return false
  return (
    (await claimExecution(ctx, { ...args, attempt: op.attempt }))?.operation
      .attempt ?? false
  )
}

/** Simulates a successful sidecar result for tests focused on database policies. */
export async function completeFileOperation(
  ctx: AuthMutationCtx,
  args: CompletionInput,
) {
  const op = await ctx.db.get(args.operationId)
  if (!op) throw new Error('Missing test operation')
  const attempt = args.attempt ?? op.attempt
  if (op.state.phase === 'queued' && attempt === op.attempt)
    await claimExecution(ctx, { operationId: op._id, attempt })
  let result: OperationResult
  switch (op.kind) {
    case 'home':
      result = { kind: op.kind, path: args.path ?? op.destination }
      break
    case 'ensure':
    case 'duplicate':
    case 'assign': {
      const path = args.path ?? (await ctx.db.get(op.homeId))?.path
      if (!path) throw new Error('Test completion requires a path')
      result = { kind: op.kind, path }
      break
    }
    default:
      result = { kind: op.kind }
  }
  return complete(ctx, { operationId: op._id, attempt, result })
}

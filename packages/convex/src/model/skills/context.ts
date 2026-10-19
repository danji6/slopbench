import type { MutationCtx } from '../../_generated/server'
import { minRole } from '../../lib/roles'
import type { PrepareContextNoteArgs } from '../../types'
import { prepareContextNote } from '../stream/contextNotes'
import { ownsExecution } from '../stream/execution'

/** Records the catalog only for a currently authorized filesystem invocation. */
export async function prepareSkillContext(
  ctx: MutationCtx,
  args: PrepareContextNoteArgs,
) {
  const stream = await ctx.db.get(args.streamId)
  if (!ownsExecution(stream, args)) return false
  const user = await ctx.db.get(stream.invokedBy)
  if (!user || !minRole(user.role, 'admin')) return false
  return prepareContextNote(ctx, args, 'skills')
}

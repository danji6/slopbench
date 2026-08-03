import type { Id } from '../../_generated/dataModel'
import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import { insertMessage } from '../messageContents'
import { scheduleMessageEval } from '../messages'
import { collectStarterPrompts, mergePrompts } from '../prompt/prompts'
import { resolveSets as resolvePromptSets } from '../prompts'
import { get as getSettings } from '../settings'
import { agentIdentity } from './identities'

export async function maybeInsertStarters(
  ctx: AuthMutationCtx,
  session: {
    _id: Id<'sessions'>
    activeAgentId?: Id<'agents'>
  },
) {
  if (!session.activeAgentId) return

  const existing = await ctx.db
    .query('messages')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', session._id))
    .first()
  if (existing) return

  const agent = await ctx.db.get(session.activeAgentId)
  if (!agent) error('Agent not found', 404)

  const settings = await getSettings(ctx)
  const sets = await resolvePromptSets(ctx, agent)

  const prompts = mergePrompts(
    { ...agent, prompts: sets.own },
    sets.global,
    sets.library,
  )
  const starters = collectStarterPrompts(prompts)
  if (starters.length === 0) return

  const identity = await agentIdentity(ctx, agent, settings)

  for (const prompt of starters) {
    const parts = [{ type: 'text', text: prompt.content }]
    const { messageId } = await insertMessage(
      ctx,
      {
        sessionId: session._id,
        sender: { type: 'agent', id: agent._id },
        role: prompt.role,
        ...identity,
        status: 'done',
      },
      parts,
    )
    await scheduleMessageEval(ctx, {
      messageId,
      invokerId: ctx.userId,
      parts,
      version: 1,
      segmentIndex: 0,
    })
  }
}

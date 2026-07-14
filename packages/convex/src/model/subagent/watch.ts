import type { Doc, Id } from '../../_generated/dataModel'
import type { AuthQueryCtx } from '../../functions'
import { getProcessingSegmentRow } from '../messageContents'
import { getActiveStream, getMembership } from '../session/memberships'

const TAIL_TEXT_CHARS = 280

export type SubagentTail = {
  /** Trailing slice of the latest streamed text. */
  text: string | null
  /** The most recent tool activity, when it is the newest part. */
  tool: { name: string; state: string } | null
}

export type SubagentWatch = {
  title: string | null
  /** Active stream status, null once the child turn settled. */
  status: Doc<'streams'>['status'] | null
  agent: { name: string; avatarId?: Id<'avatars'> } | null
  tail: SubagentTail | null
}

/**
 * Small live view of a sub-agent child session for the parent's task tool
 * part, with title, agent identity, stream status, and a capped tail of the
 * in-flight turn.
 */
export async function watch(
  ctx: AuthQueryCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
): Promise<SubagentWatch | null> {
  const session = await ctx.db.get(sessionId)
  if (!session?.parent) return null

  // Parent session members may watch even without a child membership row
  const membership =
    (await getMembership(ctx, sessionId, ctx.userId)) ??
    (await getMembership(ctx, session.parent.sessionId, ctx.userId))
  if (!membership) return null

  const agent = session.activeAgentId
    ? await ctx.db.get(session.activeAgentId)
    : null
  const stream = await getActiveStream(ctx, sessionId)

  return {
    title: session.title ?? null,
    status: stream?.status ?? null,
    agent: agent ? { name: agent.name, avatarId: agent.avatarId } : null,
    tail: stream ? await buildTail(ctx, stream) : null,
  }
}

async function buildTail(
  ctx: AuthQueryCtx,
  stream: Doc<'streams'>,
): Promise<SubagentTail | null> {
  const row = await getProcessingSegmentRow(ctx, stream)
  if (!row) return null

  let text: string | null = null
  let tool: SubagentTail['tool'] = null

  for (const part of row.parts) {
    const typed = part as { type?: string; text?: string; state?: string }
    if (typeof typed.type !== 'string') continue

    if (typed.type === 'text' && typed.text?.trim()) {
      text = typed.text
      tool = null // text after a tool means the tool is no longer the tail
    } else if (typed.type.startsWith('tool-')) {
      tool = {
        name: typed.type.slice('tool-'.length),
        state: typed.state ?? '',
      }
    }
  }

  return {
    text: text ? text.slice(-TAIL_TEXT_CHARS) : null,
    tool,
  }
}

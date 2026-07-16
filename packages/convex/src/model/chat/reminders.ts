import type { ReminderPrompt } from '@sb/core/types'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import type { MessageExtra } from '../../types'
import { insertMessage } from '../messageContents'
import { scheduleMessageEval } from '../messages'
import { getByOwnerId as getSettingsByOwnerId } from '../settings'
import { agentSenderSnapshot } from './identities'

type ReminderState = Record<string, number>

type ReminderSource = {
  reminderPrompts?: ReminderPrompt[]
  globalRemindersEnabled?: boolean
}

/** Global reminders first unless opted out, then the agent's. */
export function mergeReminders(
  agent: ReminderSource,
  globalReminders: ReminderPrompt[],
): ReminderPrompt[] {
  const merged = new Map<string, ReminderPrompt>()
  if (agent.globalRemindersEnabled !== false) {
    for (const reminder of globalReminders) merged.set(reminder.id, reminder)
  }
  for (const reminder of agent.reminderPrompts ?? []) {
    merged.set(reminder.id, reminder)
  }
  return [...merged.values()]
}

/** Decides which reminders fire at the given turn count. */
export function resolveDueReminders(
  reminders: ReminderPrompt[],
  state: ReminderState | undefined,
  turnCount: number,
): { due: ReminderPrompt[]; nextState: ReminderState } {
  const due: ReminderPrompt[] = []
  const nextState: ReminderState = {}

  for (const reminder of reminders) {
    if (!reminder.enabled || reminder.interval < 1) continue
    const last = state?.[reminder.id]
    if (last === undefined) {
      if (reminder.eager) due.push(reminder)
      nextState[reminder.id] = turnCount
    } else if (turnCount - last >= reminder.interval) {
      due.push(reminder)
      nextState[reminder.id] = turnCount
    } else {
      nextState[reminder.id] = last
    }
  }

  return { due, nextState }
}

/**
 * Inserts every due reminder as a hidden done message. Call before
 * inserting the triggering message or computing a fresh context boundary.
 */
export async function injectDueReminders(
  ctx: MutationCtx,
  session: Doc<'sessions'>,
  invokerId: Id<'users'>,
) {
  if (!session.activeAgentId) return

  const agent = await ctx.db.get(session.activeAgentId)
  if (!agent) return

  const settings = await getSettingsByOwnerId(ctx, agent.ownerId)
  const reminders = mergeReminders(
    agent as ReminderSource,
    (settings?.reminderPrompts ?? []) as ReminderPrompt[],
  )
  if (reminders.length === 0 && !session.reminderState) return

  const { due, nextState } = resolveDueReminders(
    reminders,
    session.reminderState,
    session.turnCount ?? 0,
  )

  if (!sameState(session.reminderState ?? {}, nextState)) {
    await ctx.db.patch(session._id, { reminderState: nextState })
  }
  if (due.length === 0) return

  const senderSnapshot = agentSenderSnapshot(agent, settings)

  for (const reminder of due) {
    const parts = [{ type: 'text', text: reminder.content }]
    const { messageId } = await insertMessage(
      ctx,
      {
        sessionId: session._id,
        sender: { type: 'agent', id: agent._id },
        role: reminder.role,
        senderSnapshot,
        status: 'done',
        type: 'reminder',
        hidden: true,
        extra: {
          id: reminder.id,
          name: reminder.name,
        } satisfies MessageExtra['reminder'],
      },
      parts,
    )
    await scheduleMessageEval(ctx, {
      messageId,
      invokerId,
      parts,
      version: 1,
      segmentIndex: 0,
    })
  }
}

/** Counts a new logical turn (user send, fresh agent turn, mid-stream rollover). */
export async function bumpTurnCount(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
) {
  const session = await ctx.db.get(sessionId)
  if (!session) return
  await ctx.db.patch(sessionId, { turnCount: (session.turnCount ?? 0) + 1 })
}

/**
* Rewinds the turn count after messages are deleted and adjusts reminders to
* prevent negative deltas.
*/
export async function rewindTurnCount(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  deletedTurns: number,
) {
  if (deletedTurns < 1) return
  const session = await ctx.db.get(sessionId)
  if (!session?.turnCount) return

  const turnCount = Math.max(0, session.turnCount - deletedTurns)
  const patch: { turnCount: number; reminderState?: ReminderState } = {
    turnCount,
  }
  if (session.reminderState) {
    patch.reminderState = Object.fromEntries(
      Object.entries(session.reminderState).map(([id, last]) => [
        id,
        Math.min(last, turnCount),
      ]),
    )
  }
  await ctx.db.patch(sessionId, patch)
}

function sameState(a: ReminderState, b: ReminderState) {
  const aKeys = Object.keys(a)
  return (
    aKeys.length === Object.keys(b).length &&
    aKeys.every((key) => a[key] === b[key])
  )
}

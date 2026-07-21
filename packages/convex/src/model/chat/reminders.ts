import { TODO_NUDGE_INTERVAL_TURNS, TODO_TOOL_TOGGLE } from '@sb/core/const'
import type { ReminderPrompt } from '@sb/core/types'
import { systemReminder } from '@sb/core/utils/blocks'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import type { MessageExtra, TodoItem } from '../../types'
import { getByOwnerId as getSettingsByOwnerId } from '../settings'
import {
  formatTodoList,
  getBySession as getTodosBySession,
  hasUnresolvedTodos,
} from '../todos'
import { agentSenderSnapshot } from './identities'
import { insertHiddenNote } from './notes'
import type { NoteSender } from './notes'

type ReminderState = Record<string, number>

type ReminderSource = {
  reminderPrompts?: ReminderPrompt[]
  libraryReminderIds?: string[]
}

/** Referenced library reminders first, then the agent's own. */
export function mergeReminders(
  agent: ReminderSource,
  libraryReminders: ReminderPrompt[],
): ReminderPrompt[] {
  const libraryById = new Map(libraryReminders.map((r) => [r.id, r]))
  const merged = new Map<string, ReminderPrompt>()

  for (const id of agent.libraryReminderIds ?? []) {
    const reminder = libraryById.get(id)
    if (reminder) merged.set(id, reminder)
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

/** Whether unresolved todos went stale enough to warrant a nudge. */
export function isTodoNudgeDue(
  todo: { items: TodoItem[]; turnCount: number } | null,
  turnCount: number,
  interval = TODO_NUDGE_INTERVAL_TURNS,
) {
  return (
    todo !== null &&
    hasUnresolvedTodos(todo.items) &&
    turnCount - todo.turnCount >= interval
  )
}

export function buildTodoNudgeContent(items: TodoItem[]) {
  return systemReminder(
    'Your todo list has not been updated in a while. Current todos:',
    '',
    formatTodoList(items),
    '',
    'Continue the task if it still applies and update statuses with ' +
      'edit_todo as you make progress, or clear the list with an empty ' +
      'write_todo call if it is no longer relevant.',
  )
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
  const sender: NoteSender = {
    agent,
    senderSnapshot: agentSenderSnapshot(agent, settings),
  }

  await injectConfiguredReminders(ctx, session, invokerId, sender, settings)
  await injectTodoNudge(ctx, session, invokerId, sender)
}

async function injectConfiguredReminders(
  ctx: MutationCtx,
  session: Doc<'sessions'>,
  invokerId: Id<'users'>,
  sender: NoteSender,
  settings: Doc<'settings'> | null,
) {
  const reminders = mergeReminders(
    sender.agent as ReminderSource,
    (settings?.libraryReminders ?? []) as ReminderPrompt[],
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

  for (const reminder of due) {
    await insertHiddenNote(ctx, session, invokerId, sender, {
      type: 'reminder',
      role: reminder.role,
      content: reminder.content,
      extra: {
        id: reminder.id,
        name: reminder.name,
      } satisfies MessageExtra['reminder'],
    })
  }
}

/** Nudges the agent about a stale todo list. */
async function injectTodoNudge(
  ctx: MutationCtx,
  session: Doc<'sessions'>,
  invokerId: Id<'users'>,
  sender: NoteSender,
) {
  // The nudge asks for write_todo/edit_todo calls, so it needs the toggle on
  const tools = sender.agent.tools
  if (!Array.isArray(tools) || !tools.includes(TODO_TOOL_TOGGLE)) return

  const todo = await getTodosBySession(ctx, session._id)
  const turnCount = session.turnCount ?? 0
  if (!todo || !isTodoNudgeDue(todo, turnCount)) return

  await ctx.db.patch(todo._id, { turnCount })
  await insertHiddenNote(ctx, session, invokerId, sender, {
    type: 'todo',
    role: 'system',
    content: buildTodoNudgeContent(todo.items),
  })
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

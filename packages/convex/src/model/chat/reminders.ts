import { TODO_NUDGE_INTERVAL_STEPS, TODO_TOOL_TOGGLE } from '@sb/core/const'
import type { ReminderPrompt } from '@sb/core/types'
import { systemReminder } from '@sb/core/utils/blocks'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import type { MessageExtra, TodoItem } from '../../types'
import { resolveSets as resolveReminderSets } from '../reminders'
import { getState, getStepCount, patchState } from '../session/state'
import { getByOwnerId as getSettingsByOwnerId } from '../settings'
import {
  formatTodoList,
  getBySession as getTodosBySession,
  hasUnresolvedTodos,
} from '../todos'
import { agentIdentity } from './identities'
import { insertHiddenNote } from './notes'
import type { NoteSender } from './notes'

type ReminderState = Record<string, number>

type ReminderSource = {
  libraryReminderIds?: string[]
}

/** Referenced library reminders first, then the agent's own. */
export function mergeReminders(
  agent: ReminderSource,
  own: ReminderPrompt[],
  libraryReminders: ReminderPrompt[],
): ReminderPrompt[] {
  const libraryById = new Map(libraryReminders.map((r) => [r.id, r]))
  const merged = new Map<string, ReminderPrompt>()

  for (const id of agent.libraryReminderIds ?? []) {
    const reminder = libraryById.get(id)
    if (reminder) merged.set(id, reminder)
  }
  for (const reminder of own) {
    merged.set(reminder.id, reminder)
  }
  return [...merged.values()]
}

/** Decides which reminders fire at the given step count. */
export function resolveDueReminders(
  reminders: ReminderPrompt[],
  state: ReminderState | undefined,
  stepCount: number,
): { due: ReminderPrompt[]; nextState: ReminderState } {
  const due: ReminderPrompt[] = []
  const nextState: ReminderState = {}

  for (const reminder of reminders) {
    if (!reminder.enabled || reminder.interval < 1) continue
    const last = state?.[reminder.id]
    if (last === undefined) {
      if (reminder.eager) due.push(reminder)
      nextState[reminder.id] = stepCount
    } else if (stepCount - last >= reminder.interval) {
      due.push(reminder)
      nextState[reminder.id] = stepCount
    } else {
      nextState[reminder.id] = last
    }
  }

  return { due, nextState }
}

/** Whether unresolved todos went stale enough to warrant a nudge. */
export function isTodoNudgeDue(
  todo: { items: TodoItem[]; stepCount: number } | null,
  stepCount: number,
  interval = TODO_NUDGE_INTERVAL_STEPS,
) {
  return (
    todo !== null &&
    hasUnresolvedTodos(todo.items) &&
    stepCount - todo.stepCount >= interval
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
  stepCount?: number,
) {
  if (!session.activeAgentId) return

  const agent = await ctx.db.get(session.activeAgentId)
  if (!agent) return

  const settings = await getSettingsByOwnerId(ctx, agent.ownerId)
  const sender: NoteSender = {
    agent,
    identity: await agentIdentity(ctx, agent, settings),
  }
  const currentStep = stepCount ?? (await getStepCount(ctx, session._id))

  await injectConfiguredReminders(ctx, session, invokerId, sender, currentStep)
  await injectTodoNudge(ctx, session, invokerId, sender, currentStep)
}

async function injectConfiguredReminders(
  ctx: MutationCtx,
  session: Doc<'sessions'>,
  invokerId: Id<'users'>,
  sender: NoteSender,
  stepCount: number,
) {
  const sets = await resolveReminderSets(ctx, sender.agent)
  const reminders = mergeReminders(
    sender.agent as ReminderSource,
    sets.own,
    sets.library,
  )
  const state = (await getState(ctx, session._id))?.reminderState
  if (reminders.length === 0 && !state) return

  const { due, nextState } = resolveDueReminders(reminders, state, stepCount)

  if (!sameState(state ?? {}, nextState)) {
    await patchState(ctx, session._id, { reminderState: nextState })
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
  stepCount: number,
) {
  // The nudge asks for write_todo/edit_todo calls, so it needs the toggle on
  const tools = sender.agent.tools
  if (!Array.isArray(tools) || !tools.includes(TODO_TOOL_TOGGLE)) return

  const todo = await getTodosBySession(ctx, session._id)
  if (!todo || !isTodoNudgeDue(todo, stepCount)) return

  await ctx.db.patch(todo._id, { stepCount })
  await insertHiddenNote(ctx, session, invokerId, sender, {
    type: 'todo',
    role: 'system',
    content: buildTodoNudgeContent(todo.items),
  })
}

function sameState(a: ReminderState, b: ReminderState) {
  const aKeys = Object.keys(a)
  return (
    aKeys.length === Object.keys(b).length &&
    aKeys.every((key) => a[key] === b[key])
  )
}

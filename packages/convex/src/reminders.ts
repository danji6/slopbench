import { v } from 'convex/values'

import { authMutation, authQuery } from './functions'
import * as Reminders from './model/reminders'
import * as V from './validators/args'
import { reminderScopeValidator } from './validators/sub'

export const list = authQuery({
  args: { scope: reminderScopeValidator, agentId: v.optional(v.id('agents')) },
  handler: Reminders.list,
})

export const create = authMutation({
  args: V.createReminderArgsValidator.fields,
  handler: Reminders.create,
})

export const update = authMutation({
  args: V.updateReminderArgsValidator.fields,
  handler: Reminders.update,
})

export const replaceScope = authMutation({
  args: V.replaceReminderScopeArgsValidator.fields,
  handler: Reminders.replaceScope,
})

export const remove = authMutation({
  args: { reminderId: v.id('reminders') },
  handler: Reminders.remove,
})

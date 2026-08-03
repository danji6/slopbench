import { v } from 'convex/values'

import { authMutation, authQuery } from './functions'
import * as Prompts from './model/prompts'
import * as V from './validators/args'
import { promptScopeValidator } from './validators/sub'

export const list = authQuery({
  args: { scope: promptScopeValidator, agentId: v.optional(v.id('agents')) },
  handler: Prompts.list,
})

export const create = authMutation({
  args: V.createPromptArgsValidator.fields,
  handler: Prompts.create,
})

export const update = authMutation({
  args: V.updatePromptArgsValidator.fields,
  handler: Prompts.update,
})

export const remove = authMutation({
  args: { promptId: v.id('prompts') },
  handler: Prompts.remove,
})

export const replaceScope = authMutation({
  args: V.replacePromptScopeArgsValidator.fields,
  handler: Prompts.replaceScope,
})

export const reorder = authMutation({
  args: V.reorderPromptsArgsValidator.fields,
  handler: Prompts.reorder,
})

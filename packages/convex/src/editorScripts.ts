import { v } from 'convex/values'

import { authMutation, authQuery } from './functions'
import * as Scripts from './model/editorScripts'
import {
  createScriptArgsValidator,
  updateScriptArgsValidator,
} from './validators'

export const list = authQuery({
  args: {},
  handler: Scripts.list,
})

export const get = authQuery({
  args: { scriptId: v.id('editorScripts') },
  handler: Scripts.get,
})

export const create = authMutation({
  args: createScriptArgsValidator.fields,
  handler: Scripts.create,
})

export const update = authMutation({
  args: updateScriptArgsValidator.fields,
  handler: Scripts.update,
})

export const remove = authMutation({
  args: { scriptId: v.id('editorScripts') },
  handler: Scripts.remove,
})

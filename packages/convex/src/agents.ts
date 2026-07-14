import { v } from 'convex/values'

import { authMutation, authQuery } from './functions'
import * as Agents from './model/agents'
import * as V from './validators/args'

export const list = authQuery({
  args: {},
  handler: Agents.list,
})

export const get = authQuery({
  args: { agentId: v.id('agents') },
  handler: Agents.get,
})

export const create = authMutation({
  args: V.createAgentArgsValidator.fields,
  handler: Agents.create,
})

export const update = authMutation({
  args: V.updateAgentArgsValidator.fields,
  handler: Agents.update,
})

export const remove = authMutation({
  args: { agentId: v.id('agents') },
  handler: Agents.remove,
})

export const clearAvatar = authMutation({
  args: { agentId: v.id('agents') },
  handler: Agents.clearAvatar,
})

export const duplicate = authMutation({
  args: { agentId: v.id('agents') },
  handler: Agents.duplicate,
})

export const generateAvatarUploadUrl = authMutation({
  args: {},
  handler: Agents.generateAvatarUploadUrl,
})

export const confirmAvatarUpload = authMutation({
  args: { agentId: v.id('agents'), avatarId: v.id('avatars') },
  handler: Agents.confirmAvatarUpload,
})

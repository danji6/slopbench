'use node'

import { v } from 'convex/values'

import { action } from '../_generated/server'
import {
  toolkitIdValidator,
  toolkitSkillsValidator,
} from '../validators/toolkits'

export const link = action({
  args: { root: v.string() },
  handler: async (ctx, { root }) => {
    const { link } = await import('../model/toolkits/actions')
    return link(ctx, root)
  },
})

export const refresh = action({
  args: toolkitIdValidator,
  handler: async (ctx, args) => {
    const { refresh } = await import('../model/toolkits/actions')
    return refresh(ctx, args.toolkitId)
  },
})

export const discover = action({
  args: { sessionId: v.id('sessions') },
  handler: async (ctx, { sessionId }) => {
    const { discover } = await import('../model/toolkits/actions')
    return discover(ctx, sessionId)
  },
})

export const skills = action({
  args: toolkitSkillsValidator,
  handler: async (ctx, args) => {
    const { previewSkills } = await import('../model/toolkits/skillPreview')
    return previewSkills(ctx, args)
  },
})

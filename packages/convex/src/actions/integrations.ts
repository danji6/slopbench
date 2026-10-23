'use node'

import { v } from 'convex/values'

import { action } from '../_generated/server'
import {
  integrationIdValidator,
  integrationSkillsValidator,
} from '../validators/integrations'

export const link = action({
  args: { root: v.string() },
  handler: async (ctx, { root }) => {
    const { link } = await import('../model/integrations/actions')
    return link(ctx, root)
  },
})

export const refresh = action({
  args: integrationIdValidator,
  handler: async (ctx, args) => {
    const { refresh } = await import('../model/integrations/actions')
    return refresh(ctx, args.integrationId)
  },
})

export const discover = action({
  args: { sessionId: v.id('sessions') },
  handler: async (ctx, { sessionId }) => {
    const { discover } = await import('../model/integrations/actions')
    return discover(ctx, sessionId)
  },
})

export const skills = action({
  args: integrationSkillsValidator,
  handler: async (ctx, args) => {
    const { previewSkills } = await import('../model/integrations/skillPreview')
    return previewSkills(ctx, args)
  },
})

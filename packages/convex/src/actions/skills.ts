'use node'

import { v } from 'convex/values'

import { action, internalAction } from '../_generated/server'

export const _run = internalAction({
  args: { operationId: v.id('agentFileOperations') },
  handler: async (ctx, { operationId }) => {
    const { run } = await import('../model/skills/filesAction')
    await run(ctx, operationId)
  },
})

export const _expireUpload = internalAction({
  args: { uploadId: v.id('skillUploads') },
  handler: async (ctx, { uploadId }) => {
    const { expireUpload } = await import('../model/skills/uploadAction')
    await expireUpload(ctx, uploadId)
  },
})

export const desktop = action({
  args: {},
  handler: async (ctx) => {
    const { desktopInfo } = await import('../model/skills/runtime')
    return desktopInfo(ctx)
  },
})

export const openFolder = action({
  args: { agentId: v.id('agents') },
  handler: async (ctx, { agentId }) => {
    const { openFolder } = await import('../model/skills/runtime')
    return openFolder(ctx, agentId)
  },
})

export const homeStatus = action({
  args: { agentId: v.id('agents') },
  handler: async (ctx, { agentId }) => {
    const { homeStatus } = await import('../model/skills/runtime')
    return homeStatus(ctx, agentId)
  },
})

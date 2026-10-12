'use node'

import { v } from 'convex/values'

import { internalAction } from '../_generated/server'

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

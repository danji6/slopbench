'use node'

import { action } from '../_generated/server'
import * as V from '../validators/args'

export const change = action({
  args: V.folderChangeArgs.fields,
  handler: async (ctx, args) => {
    const { changeFolder } = await import('./session/folders')
    return changeFolder(ctx, args)
  },
})

export const move = action({
  args: V.folderMoveArgs.fields,
  handler: async (ctx, args) => {
    const { changeFolder } = await import('./session/folders')
    return changeFolder(ctx, args)
  },
})

export const create = action({
  args: V.folderCreateArgs.fields,
  handler: async (ctx, args) => {
    const { createFolder } = await import('./session/folders')
    return createFolder(ctx, args)
  },
})

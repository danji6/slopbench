import { v } from 'convex/values'

import type { AuthMutationCtx } from './functions'
import { authMutation, authQuery } from './functions'
import * as Settings from './model/settings'

export const get = authQuery({
  args: {},
  handler: Settings.getOrDefault,
})

export const update = authMutation({
  args: { patch: v.record(v.string(), v.any()) },
  handler: (ctx: AuthMutationCtx, { patch }) =>
    Settings.update(ctx, {
      patch: patch as Parameters<typeof Settings.update>[1]['patch'],
    }),
})

export const remove = authMutation({
  args: { key: v.string() },
  handler: (ctx: AuthMutationCtx, { key }) =>
    Settings.remove(ctx, {
      key: key as Parameters<typeof Settings.remove>[1]['key'],
    }),
})

'use node'

import { randomUUID } from 'node:crypto'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { authorize, authorizeAdmin } from '../../functions'
import type { FolderCreateArgs } from '../../types'
import type { FolderTransitionArgs } from '../../types'

export async function changeFolder(
  ctx: ActionCtx,
  input: Omit<FolderTransitionArgs, 'subject' | 'token'>,
) {
  const { postSidecar } = await import('../../model/sidecar')

  const identity = input.sources
    ? await authorizeAdmin(ctx)
    : await authorize(ctx)

  const sources = input.sources
    ? await postSidecar<NonNullable<FolderTransitionArgs['sources']>>(
        '/workspace/validate-sources',
        { sources: input.sources },
      )
    : undefined

  const args = {
    ...input,
    ...(sources ? { sources } : {}),
    subject: identity.subject,
    token: `${Date.now() + 60_000}:${randomUUID()}`,
  }

  const state = await ctx.runMutation(internal.sessionFolders._begin, args)

  let committed = false
  try {
    if (state.needsSidecar) {
      await postSidecar('/workspace/lock', {
        sessionIds: state.sessionIds,
        token: args.token,
      })
    }
    await ctx.runMutation(internal.sessionFolders._finish, {
      ...args,
      targetRevision: state.targetRevision,
      commit: true,
    })
    committed = true
  } finally {
    if (!committed) {
      await ctx.runMutation(internal.sessionFolders._finish, {
        ...args,
        commit: false,
      })
    }
    if (state.needsSidecar) {
      await postSidecar('/workspace/unlock', {
        sessionIds: state.sessionIds,
        token: args.token,
      }).catch(() => undefined) // the lease also expires automatically
    }
  }
}

export async function createFolder(
  ctx: ActionCtx,
  args: FolderCreateArgs,
): Promise<Id<'sessionFolders'>> {
  const identity = args.sources.length
    ? await authorizeAdmin(ctx)
    : await authorize(ctx)

  const { postSidecar } = await import('../../model/sidecar')

  const sources = args.sources.length
    ? await postSidecar<FolderCreateArgs['sources']>(
        '/workspace/validate-sources',
        { sources: args.sources },
      )
    : []

  return ctx.runMutation(internal.sessionFolders._createWithSources, {
    ...args,
    sources,
    subject: identity.subject,
  })
}

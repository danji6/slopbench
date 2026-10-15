'use node'

import { randomUUID } from 'node:crypto'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { authorize, authorizeAdmin } from '../../functions'
import type { begin } from '../../model/session/folderTransitions'
import type { postSidecar } from '../../model/sidecar'
import type { FolderCreateArgs } from '../../types'
import type { FolderTransitionArgs } from '../../types'

export async function changeFolder(
  ctx: ActionCtx,
  input: Pick<FolderTransitionArgs, 'command'>,
): Promise<number | undefined> {
  const { postSidecar } = await import('../../model/sidecar')
  const command = input.command

  const identity =
    command.kind === 'update-sources'
      ? await authorizeAdmin(ctx)
      : await authorize(ctx)

  const validated =
    command.kind === 'update-sources'
      ? {
          ...command,
          sources: await postSidecar<typeof command.sources>(
            '/workspace/validate-sources',
            { sources: command.sources },
          ),
        }
      : command

  const args = {
    command: validated,
    subject: identity.subject,
    token: `${Date.now() + 60_000}:${randomUUID()}`,
  }

  const state = await ctx.runMutation(internal.sessionFolders._begin, args)
  if (state.kind === 'completed') return state.organizationRevision
  return commitPrepared(ctx, args, state, postSidecar)
}

type Prepared = Extract<Awaited<ReturnType<typeof begin>>, { kind: 'prepared' }>
type PostSidecar = typeof postSidecar

/** Commits prepared work and independently attempts both cleanup steps. */
export async function commitPrepared(
  ctx: ActionCtx,
  args: Pick<FolderTransitionArgs, 'subject' | 'token'>,
  state: Prepared,
  post: PostSidecar,
): Promise<number | undefined> {
  let committed = false
  const lease = { sessionIds: state.sessionIds, token: args.token }
  try {
    if (state.needsSidecar) await post('/workspace/lock', lease)
    const revision = await ctx.runMutation(internal.sessionFolders._commit, {
      subject: args.subject,
      token: args.token,
      plan: state.plan,
    })
    committed = true
    return typeof revision === 'number' ? revision : undefined
  } finally {
    if (!committed) {
      await ctx
        .runMutation(internal.sessionFolders._cancel, {
          subject: args.subject,
          token: args.token,
          target: state.target,
        })
        .catch((err) => console.error('Folder cancellation failed', err))
    }
    if (state.needsSidecar) {
      await post('/workspace/unlock', lease).catch((err) =>
        console.error('Folder unlock failed', err),
      )
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

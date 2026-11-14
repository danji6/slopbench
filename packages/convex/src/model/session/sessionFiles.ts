import { transitionActive } from '@cv/core/workspace/transition'
import {
  adjectives,
  animals,
  uniqueNamesGenerator,
} from 'unique-names-generator'

import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { findUserBySubject } from '../../functions'
import { getMembership } from './memberships'
import { duplicate } from './sessionDuplicate'
import { remove } from './sessionTeardown'

type Operation = Doc<'sessionFileOperations'>

export async function reserveTaskDirectory(
  ctx: MutationCtx,
  rootId: Id<'sessions'>,
) {
  let name = ''
  for (let index = 0; index < 4; index++) {
    name = uniqueNamesGenerator({
      dictionaries: [adjectives, animals],
      length: 2,
      separator: '-',
    })
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    if (!(await directoryReserved(ctx, rootId, name)))
      return reserve(ctx, rootId, name)
  }

  let suffix = 2
  while (await directoryReserved(ctx, rootId, `${name}-${suffix}`)) suffix++
  return reserve(ctx, rootId, `${name}-${suffix}`)
}

async function directoryReserved(
  ctx: MutationCtx,
  rootId: Id<'sessions'>,
  name: string,
) {
  return !!(await ctx.db
    .query('sessionTaskDirectories')
    .withIndex('by_rootId_name', (q) => q.eq('rootId', rootId).eq('name', name))
    .first())
}

async function reserve(ctx: MutationCtx, rootId: Id<'sessions'>, name: string) {
  await ctx.db.insert('sessionTaskDirectories', { rootId, name })
  return name
}

export async function settle(
  ctx: MutationCtx,
  operation: Operation,
  success: boolean,
) {
  if (operation.kind === 'duplicate') {
    const source = await ctx.db.get(operation.sourceId)
    const target = await ctx.db.get(operation.sessionId)
    const sourceLocked = source?.contextLock === operation.token
    success &&= sourceLocked
    if (sourceLocked) await ctx.db.patch(source._id, { contextLock: undefined })
    if (target) {
      if (success) await makeDuplicateAvailable(ctx, target, operation.sourceId)
      else await removeFailedDuplicate(ctx, target)
    } else {
      success = false
    }
  }
  await ctx.db.delete(operation._id)
  return success
}

async function makeDuplicateAvailable(
  ctx: MutationCtx,
  target: Doc<'sessions'>,
  sourceId: Id<'sessions'>,
) {
  const reservations = await ctx.db
    .query('sessionTaskDirectories')
    .withIndex('by_rootId_name', (q) => q.eq('rootId', sourceId))
    .collect()
  for (const { name } of reservations) await reserve(ctx, target._id, name)
  const member = await getMembership(ctx, target._id, target.ownerId)
  if (member) await ctx.db.patch(member._id, { hidden: undefined })
  await ctx.db.patch(target._id, { sessionFilesPending: undefined })
}

async function removeFailedDuplicate(
  ctx: MutationCtx,
  target: Doc<'sessions'>,
) {
  const owner = await ctx.db.get(target.ownerId)
  if (owner) {
    await remove(
      { ...ctx, userId: owner._id, role: owner.role, subject: owner.subject },
      { sessionId: target._id },
    )
  }
}

export async function claim(
  ctx: MutationCtx,
  id: Id<'sessionFileOperations'>,
  immediate: boolean,
) {
  const row = await ctx.db.get(id)
  if (
    !row ||
    (row.nextAttemptAt > Date.now() &&
      (!immediate || row.attempt !== undefined))
  ) {
    return null
  }
  if (row.kind === 'duplicate' && !transitionActive(row.token)) {
    await settle(ctx, row, false)
    return null
  }

  const attempt = (row.attempt ?? 0) + 1
  await ctx.db.patch(id, { attempt, nextAttemptAt: Date.now() + 60_000 })

  return { ...row, attempt }
}

export async function finish(
  ctx: MutationCtx,
  id: Id<'sessionFileOperations'>,
  attempt: number,
  success: boolean,
) {
  const row = await ctx.db.get(id)
  if (!row || row.attempt !== attempt) return false
  if (row.kind === 'delete' && !success) return false
  const committed =
    row.kind === 'duplicate' ? success && transitionActive(row.token) : success
  return settle(ctx, row, committed)
}

export async function sweep(ctx: MutationCtx) {
  const pending = await ctx.db
    .query('sessionFileOperations')
    .withIndex('by_nextAttemptAt', (q) => q.lte('nextAttemptAt', Date.now()))
    .take(100)
  for (const row of pending) {
    await ctx.scheduler.runAfter(
      0,
      internal.actions.sessions._runSessionFileOperation,
      {
        operationId: row._id,
      },
    )
  }
}

export async function beginDuplicate(
  ctx: MutationCtx,
  args: {
    sessionId: Id<'sessions'>
    title?: string
    subject: string
    token: string
  },
) {
  const owner = await findUserBySubject(ctx, args.subject)
  if (!owner) return null
  return duplicate(
    { ...ctx, userId: owner._id, role: owner.role, subject: owner.subject },
    args,
    { token: args.token },
  )
}

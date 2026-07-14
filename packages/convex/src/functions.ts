import {
  customMutation,
  customQuery,
} from 'convex-helpers/server/customFunctions'
import type { GenericActionCtx, UserIdentity } from 'convex/server'

import { internal } from './_generated/api'
import type { DataModel, Id } from './_generated/dataModel'
import { mutation as _mutation, query as _query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { error } from './errors'
import { ROLE, type Role, minRole } from './lib/roles'
import * as Settings from './model/settings'

type Ctx = QueryCtx | MutationCtx | GenericActionCtx<DataModel>

export type AuthQueryCtx = QueryCtx & {
  subject: string
  userId: Id<'users'>
  role: Role
}

export type AuthMutationCtx = MutationCtx & {
  subject: string
  userId: Id<'users'>
  role: Role
}

export const authQuery = customQuery(_query, {
  args: {},
  async input(ctx: QueryCtx) {
    const identity = await authorize(ctx)
    const user = await findUserBySubject(ctx, identity.subject)
    if (!user) error('Profile not initialized', 409)
    return {
      ctx: {
        ...ctx,
        subject: identity.subject,
        userId: user._id,
        role: user.role,
      },
      args: {},
    }
  },
})

export const authMutation = customMutation(_mutation, {
  args: {},
  async input(ctx: MutationCtx) {
    const identity = await authorize(ctx)
    const existing = await findUserBySubject(ctx, identity.subject)
    const role = existing?.role ?? (await getNewUserRole(ctx))

    const userId =
      existing?._id ??
      (await ctx.db.insert('users', {
        subject: identity.subject,
        role,
      }))

    if (!existing && identity.name) {
      await Settings.ensureForUser(ctx, userId, { displayName: identity.name })
    }

    return {
      ctx: {
        ...ctx,
        subject: identity.subject,
        userId,
        role,
      },
      args: {},
    }
  },
})

export async function authorize(ctx: Ctx): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) error('Unauthorized', 401)
  return identity
}

export async function getSubject(ctx: Ctx): Promise<string> {
  return (await authorize(ctx)).subject
}

export async function authorizeAdmin(ctx: Ctx): Promise<UserIdentity> {
  const identity = await authorize(ctx)
  const role =
    'db' in ctx
      ? (await findUserBySubject(ctx, identity.subject))?.role
      : await ctx.runQuery(internal.users._getRoleBySubject, {
          subject: identity.subject,
        })
  if (!minRole(role, 'admin')) error('Forbidden', 403)
  return identity
}

export function requireRole(role: Role | undefined | null, required: Role) {
  if (!role) error('Unauthorized', 401)
  if (ROLE[role] < ROLE[required]) error('Forbidden', 403)
}

export async function findUserBySubject(
  ctx: QueryCtx | MutationCtx,
  subject: string,
) {
  return ctx.db
    .query('users')
    .withIndex('by_subject', (q) => q.eq('subject', subject))
    .unique()
}

export async function getNewUserRole(ctx: QueryCtx | MutationCtx) {
  const firstUser = await ctx.db.query('users').first()
  return firstUser ? 'user' : 'admin'
}

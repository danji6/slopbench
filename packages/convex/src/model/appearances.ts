import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { ThemeSnapshot } from '../types'

export type Appearance = {
  css?: string
  theme?: ThemeSnapshot
}

/** The look a message was sent with, identified by their css+theme hash. */
export async function resolve(
  ctx: MutationCtx,
  { css, theme }: Appearance,
): Promise<Id<'appearances'> | undefined> {
  if (!css && !theme) return undefined

  const hash = await hashAppearance({ css, theme })
  const existing = await ctx.db
    .query('appearances')
    .withIndex('by_hash', (q) => q.eq('hash', hash))
    .first()
  if (existing) return existing._id

  return ctx.db.insert('appearances', { hash, css, theme })
}

export async function get(
  ctx: QueryCtx,
  appearanceId: Id<'appearances'>,
): Promise<Appearance | null> {
  const row = await ctx.db.get(appearanceId)
  return row ? toAppearance(row) : null
}

export async function getMap(
  ctx: QueryCtx,
  { ids }: { ids: Id<'appearances'>[] },
): Promise<Record<string, Appearance | null>> {
  const entries = await Promise.all(
    [...new Set(ids)].map(async (id) => [id, await get(ctx, id)] as const),
  )
  return Object.fromEntries(entries)
}

export function toAppearance({ css, theme }: Doc<'appearances'>): Appearance {
  return { css, theme }
}

async function hashAppearance(appearance: Appearance): Promise<string> {
  const bytes = new TextEncoder().encode(stabilize(appearance))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** Makes equal looks hash the same whatever their key order is. */
function stabilize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stabilize).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stabilize(entry)}`)

  return `{${entries.join(',')}}`
}

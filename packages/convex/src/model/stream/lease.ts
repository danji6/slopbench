import type { Doc } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'

export const STREAM_LEASE_MS = 5 * 60 * 1000
const LEASE_RENEW_INTERVAL_MS = 60 * 1000

/** Renews at most once a minute so token patches do not keep writing stream control state. */
export async function renewStreamLease(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
) {
  const now = Date.now()
  if (stream.leaseExpiresAt > now + STREAM_LEASE_MS - LEASE_RENEW_INTERVAL_MS)
    return
  await ctx.db.patch(stream._id, { leaseExpiresAt: now + STREAM_LEASE_MS })
}

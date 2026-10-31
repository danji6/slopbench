import { stream } from 'convex-helpers/server/stream'

import type { AuthQueryCtx } from '../../functions'
import schema from '../../schema'
import type { AgentPageArgs } from '../../types'

/** Searches all owned agents in bounded pages, ordered by explicit selection. */
export async function page(ctx: AuthQueryCtx, args: AgentPageArgs) {
  const search = args.search?.trim().toLocaleLowerCase() ?? ''
  const result = await stream(ctx.db, schema)
    .query('agents')
    .withIndex('by_ownerId_lastSelectedAt', (q) => q.eq('ownerId', ctx.userId))
    .order('desc')
    .filterWith(async (agent) => {
      const text = `${agent.name}\n${agent.description ?? ''}`
      return text.toLocaleLowerCase().includes(search)
    })
    .paginate({ ...args.paginationOpts, maximumRowsRead: 100 })

  return {
    ...result,
    page: result.page.map(({ _id, name, description, avatarId }) => ({
      _id,
      name,
      description,
      avatarId,
    })),
  }
}

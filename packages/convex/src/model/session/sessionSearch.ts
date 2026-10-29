import {
  type SessionSearchClause,
  matchesSessionSearch,
} from '@sb/core/session-search/filters'

import type { Id } from '../../_generated/dataModel'
import type { AuthQueryCtx } from '../../functions'
import type { ListSessionsArgs, SessionListItem } from '../../types'
import { readFolderTrail } from './folderTree'

/** Selects title relevance, global activity, or the normal folder listing. */
export function sessionListQuery(
  ctx: AuthQueryCtx,
  args: ListSessionsArgs,
  text: string,
) {
  const rows = ctx.db.query('userSessions')
  if (text) {
    return rows.withSearchIndex('search_title', (q) =>
      q.search('title', text).eq('userId', ctx.userId).eq('hidden', undefined),
    )
  }
  if (args.search?.trim()) {
    return rows
      .withIndex('by_userId_hidden_lastMessageAt', (q) =>
        q.eq('userId', ctx.userId).eq('hidden', undefined),
      )
      .order('desc')
  }
  return rows
    .withIndex('by_user_group_activity', (q) =>
      q
        .eq('userId', ctx.userId)
        .eq('hidden', undefined)
        .eq('groupKey', args.groupKey ?? 'ungrouped'),
    )
    .order('desc')
}

/** Resolves personal folder ancestry once per query, without storing search data. */
export async function sessionSearchMatcher(
  ctx: AuthQueryCtx,
  clauses: SessionSearchClause[],
) {
  const needsFolders = clauses.some((clause) => clause.key === 'folder')
  const namesByFolder = new Map<string, Promise<string[]>>()

  async function folderNames(id?: Id<'sessionFolders'>) {
    if (!needsFolders || !id) return []
    let names = namesByFolder.get(id)
    if (!names) {
      names = readFolderTrail(ctx, id, ctx.userId).then((trail) =>
        trail.map((folder) => folder.name),
      )
      namesByFolder.set(id, names)
    }
    return names
  }

  return async (item: SessionListItem) =>
    matchesSessionSearch(clauses, {
      folderNames: await folderNames(
        item.folderId as Id<'sessionFolders'> | undefined,
      ),
      participants: item.participants,
    })
}

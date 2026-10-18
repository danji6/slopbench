import {
  type SessionSearchClause,
  matchesSessionSearch,
} from '@sb/core/session-search/filters'

import type { AuthQueryCtx } from '../../functions'
import type { ListSessionsArgs, SessionListItem } from '../../types'
import { checkedTrail, ownerFolders } from './folderTree'

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
  const folders = needsFolders ? await ownerFolders(ctx, ctx.userId) : []
  const namesByFolder = new Map<string, string[]>()

  function folderNames(id?: string) {
    if (!needsFolders || !id) return []
    let names = namesByFolder.get(id)
    if (!names) {
      names = checkedTrail(folders, id).map((folder) => folder.name)
      namesByFolder.set(id, names)
    }
    return names
  }

  return (item: SessionListItem) =>
    matchesSessionSearch(clauses, {
      folderNames: folderNames(item.folderId),
      participants: item.participants,
    })
}

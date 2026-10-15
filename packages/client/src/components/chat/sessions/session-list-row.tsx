import type { GroupRow } from '@/lib/chat/session-groups'
import { cn } from '@/lib/utils'
import { memo } from 'react'

import { FolderGroupRow } from './folder-group-row'
import { SessionRow } from './session-row'

type SessionListRowProps = {
  row: Extract<GroupRow, { kind: 'session' }>
  pending: boolean
  dropPending: boolean
  hasSources: boolean
  hasUnreadNotification: boolean
  showFolder: boolean
  rename: (id: string) => void
}

/** Keeps unchanged session rows out of folder expansion renders. */
export const SessionListRow = memo(function SessionListRow({
  row,
  pending,
  dropPending,
  hasSources,
  hasUnreadNotification,
  showFolder,
  rename,
}: SessionListRowProps) {
  const content = (
    <div
      className={cn(
        'py-0.5',
        row.key !== 'search' && row.key !== 'ungrouped' && 'ps-3',
      )}
    >
      <SessionRow
        showFolder={showFolder}
        id={row.id}
        dropPending={dropPending}
        hasUnreadNotification={hasUnreadNotification}
        rename={rename}
      />
    </div>
  )
  if (row.key === 'search') return content
  return (
    <FolderGroupRow
      row={row}
      last={Boolean(row.last)}
      pending={pending}
      hasSources={hasSources}
    >
      {content}
    </FolderGroupRow>
  )
})

import { Collapsible } from '@/components/ui/collapsible'
import {
  type SessionGroupPage,
  SessionGroupPreload,
  SessionGroupQuery,
} from '@/hooks/chat/sessions'
import { isFolderCollapsed } from '@/lib/chat/session-folder-state'
import {
  type GroupRow,
  type SessionTreeNode,
  nestSessionRows,
} from '@/lib/chat/session-groups'
import { type ReactNode, useMemo } from 'react'

import { FolderBranchContent } from './folder-branch-content'
import { SessionPage, type SessionRowRenderer } from './session-page'

type SessionTreeProps = {
  rows: GroupRow[]
  collapsed: Record<string, boolean>
  renderRow: SessionRowRenderer
  search: string
  pages: Record<string, SessionGroupPage>
  dragging: boolean
}

/** Animates and unloads each folder's contents as one branch. */
export function SessionTree({
  rows,
  collapsed,
  renderRow,
  search,
  pages,
  dragging,
}: SessionTreeProps) {
  const nodes = useMemo(() => nestSessionRows(rows), [rows])

  function renderBranch(node: SessionTreeNode, ancestorOpen = true): ReactNode {
    const { row, children } = node
    const open = !isFolderCollapsed(collapsed, row.key, row.folderAncestorIds)
    const branchOpen = open && ancestorOpen
    const header = open
      ? row
      : {
          ...row,
          last: true,
          endingFolderIds: node.endingFolderIds,
        }

    return (
      <Collapsible key={row.key} open={open} data-session-folder={row.key}>
        {renderRow(header)}
        {ancestorOpen && <SessionGroupPreload groupKey={row.key} />}
        <FolderBranchContent
          open={open}
          disabled={dragging || !ancestorOpen}
          ready={Boolean(
            pages[row.key] && pages[row.key]?.status !== 'LoadingFirstPage',
          )}
        >
          <SessionGroupQuery groupKey={row.key} />
          <SessionPage
            groupKey={row.key}
            rows={children
              .filter((child) => child.row.kind !== 'header')
              .map((child) => child.row)}
            page={pages[row.key]}
            disabled={dragging || !branchOpen}
            renderRow={renderRow}
            animate={false}
          >
            {children
              .filter((child) => child.row.kind === 'header')
              .map((child) => renderBranch(child, branchOpen))}
          </SessionPage>
        </FolderBranchContent>
      </Collapsible>
    )
  }

  return (
    <>
      <SessionGroupQuery
        key={search.trim() ? 'query:search' : 'query:ungrouped'}
        groupKey={search.trim() ? 'search' : 'ungrouped'}
        search={search}
      />
      <SessionPage
        key={search.trim() ? `page:search:${search}` : 'page:ungrouped'}
        groupKey={search.trim() ? 'search' : 'ungrouped'}
        rows={nodes
          .filter((node) => node.row.kind !== 'header')
          .map((node) => node.row)}
        page={pages[search.trim() ? 'search' : 'ungrouped']}
        disabled={dragging}
        renderRow={renderRow}
        folderIds={nodes
          .filter((node) => node.row.kind === 'header')
          .map((node) => node.row.key)}
      >
        {nodes
          .filter((node) => node.row.kind === 'header')
          .map((node) => renderBranch(node))}
      </SessionPage>
    </>
  )
}

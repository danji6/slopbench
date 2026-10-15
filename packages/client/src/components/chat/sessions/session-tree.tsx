import { Collapsible } from '@/components/ui/collapsible'
import { type SessionGroupPage, SessionGroupQuery } from '@/hooks/chat/sessions'
import {
  type GroupRow,
  type SessionTreeNode,
  nestSessionRows,
} from '@/lib/chat/session-groups'
import { type ReactNode, useMemo } from 'react'

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
    const open = !collapsed[row.key]
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
        <Collapsible.Content unmountOnClose className="gap-0 p-0">
          <SessionGroupQuery groupKey={row.key} />
          {children
            .filter((child) => child.row.kind === 'header')
            .map((child) => renderBranch(child, branchOpen))}
          <SessionPage
            groupKey={row.key}
            rows={children
              .filter((child) => child.row.kind !== 'header')
              .map((child) => child.row)}
            page={pages[row.key]}
            disabled={dragging || !branchOpen}
            renderRow={renderRow}
          />
        </Collapsible.Content>
      </Collapsible>
    )
  }

  return (
    <>
      <SessionGroupQuery
        key={search.trim() ? 'search' : 'ungrouped'}
        groupKey={search.trim() ? 'search' : 'ungrouped'}
        search={search}
      />
      {nodes
        .filter((node) => node.row.kind === 'header')
        .map((node) => renderBranch(node))}
      <SessionPage
        key={search.trim() ? `search:${search}` : 'ungrouped'}
        groupKey={search.trim() ? 'search' : 'ungrouped'}
        rows={nodes
          .filter((node) => node.row.kind !== 'header')
          .map((node) => node.row)}
        page={pages[search.trim() ? 'search' : 'ungrouped']}
        disabled={dragging}
        renderRow={renderRow}
      />
    </>
  )
}

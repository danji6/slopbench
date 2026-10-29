import { useSessionPageReveal } from '@/hooks/chat/session-page-reveal'
import type { SessionGroupPage } from '@/hooks/chat/sessions'
import type { GroupRow } from '@/lib/chat/session-groups'
import type { ReactNode } from 'react'

export type SessionPageControls = {
  loadMore: () => void
  revealing: boolean
}

export type SessionRowRenderer = (
  row: GroupRow,
  controls?: SessionPageControls,
) => ReactNode

type SessionPageProps = {
  groupKey: string
  rows: GroupRow[]
  page?: SessionGroupPage
  disabled: boolean
  renderRow: SessionRowRenderer
  children?: ReactNode
  folderIds?: string[]
  animate?: boolean
}

/** Keeps existing rows mounted while appended rows are revealed as one block. */
export function SessionPage({
  groupKey,
  rows,
  page,
  disabled,
  renderRow,
  children,
  folderIds = [],
  animate = true,
}: SessionPageProps) {
  const sessions = rows.filter((row) => row.kind === 'session')
  const separator = rows.find((row) => row.kind === 'separator')
  const footer = rows.find((row) => row.kind === 'footer')

  const { ref, contentRef, loadMore, revealing } = useSessionPageReveal({
    ids: [
      ...folderIds.map((id) => `folder:${id}`),
      ...sessions.map((row) => row.id),
    ],
    page,
    disabled: disabled || !animate,
  })

  return (
    <>
      <div ref={ref} data-session-page={groupKey}>
        <div ref={contentRef}>
          {children}
          {separator && renderRow(separator)}
          {sessions.map((row) => (
            <div key={row.id}>{renderRow(row)}</div>
          ))}
          {footer && (
            <div
              data-slot="session-page-footer"
              data-page-footer={groupKey}
              className="[overflow-anchor:none]"
            >
              {renderRow(footer, { loadMore, revealing })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

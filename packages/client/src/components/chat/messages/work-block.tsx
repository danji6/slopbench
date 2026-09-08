import { Accordion, Button } from '@/components/ui'
import { useIsMessageStreaming } from '@/hooks/chat/stream'
import type { MessageRecord, PartMetadata } from '@/lib/chat'
import { type MessageRow, segmentGroupsFor } from '@/lib/chat/rows'
import { workExpansion } from '@/lib/chat/work-state'
import { summarizeWork } from '@/lib/chat/work-summary'
import { cn } from '@/lib/utils'
import type { UIMessage } from 'ai'
import { useMemo, useSyncExternalStore } from 'react'

import { useMessageList } from './message-list/message-list-context'

type WorkBlockProps = {
  row: Extract<MessageRow, { kind: 'work' }>
  message: UIMessage
  record?: MessageRecord
  partMeta?: PartMetadata
}

/** Toggles virtualized work rows without mounting a second scrolling container. */
export function WorkBlock({ row, message, record, partMeta }: WorkBlockProps) {
  const open = useSyncExternalStore(workExpansion.subscribe, () =>
    workExpansion.getSnapshot().has(row.work.id),
  )
  const list = useMessageList()
  const isStreaming = useIsMessageStreaming(message.id)

  const summary = useMemo(
    () =>
      summarizeWork(
        row.work,
        segmentGroupsFor(message, record),
        partMeta?.toolErrors,
      ),
    [row.work, message, record, partMeta?.toolErrors],
  )

  const toggle = () => {
    list?.onLayoutChange()
    const animate = !window.matchMedia('(prefers-reduced-motion: reduce)')
      .matches
    const mountedRows = animate
      ? new Set(
          Array.from(
            document.querySelectorAll<HTMLElement>(
              `[data-work-id="${CSS.escape(row.work.id)}"]`,
            ),
            (element) => element.dataset.rowKey!,
          ),
        )
      : undefined
    workExpansion.setOpen(row.work.id, !open, mountedRows)
  }

  return (
    <Button
      data-slot="work-block"
      data-open={open}
      variant="plain"
      size={null}
      aria-expanded={open}
      aria-label={`${open ? 'Collapse' : 'Expand'} work: ${summary.label}`}
      onClick={toggle}
      className="text-muted-foreground mb-2 flex min-h-9 max-w-full items-center justify-start gap-2 py-1 text-left text-xs whitespace-normal"
    >
      <span
        className={cn(
          'min-w-0 wrap-anywhere',
          isStreaming && summary.running && 'text-shimmer',
        )}
      >
        {summary.label}
        {row.work.partial && ' · loaded portion'}
        {summary.failures > 0 && (
          <span className="text-destructive"> · {summary.failures} failed</span>
        )}
      </span>
      <Accordion.Icon isExpanded={open} className="shrink-0" />
    </Button>
  )
}

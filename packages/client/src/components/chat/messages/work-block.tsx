import { Accordion, Button } from '@/components/ui'
import { useScrollIntoView } from '@/hooks/chat/scroll-into-view'
import { useIsMessageStreaming } from '@/hooks/chat/stream'
import type { MessageRecord, PartMetadata } from '@/lib/chat'
import { type MessageRow, segmentGroupsFor } from '@/lib/chat/rows'
import { workExpansion } from '@/lib/chat/work-state'
import { summarizeWork } from '@/lib/chat/work-summary'
import { cn } from '@/lib/utils'
import type { UIMessage } from 'ai'
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import { useMessageList } from './message-list/message-list-context'
import { getMountedTransitionRows } from './virtualized-row-transition'

type WorkBlockProps = {
  row: Extract<MessageRow, { kind: 'work' }>
  message: UIMessage
  record?: MessageRecord
  partMeta?: PartMetadata
}

/** Toggles virtualized work rows without mounting a second scrolling container. */
export function WorkBlock({ row, message, record, partMeta }: WorkBlockProps) {
  const workId = row.work.id
  const open = useSyncExternalStore(workExpansion.subscribe, () =>
    workExpansion.getSnapshot().has(workId),
  )
  const list = useMessageList()
  const isStreaming = useIsMessageStreaming(message.id)
  const blockRef = useRef<HTMLButtonElement>(null)
  const [revealOnOpen, setRevealOnOpen] = useState(false)
  const getBlockBottom = useCallback(
    (trigger: HTMLElement) => getWorkBottom(trigger, workId),
    [workId],
  )
  useScrollIntoView({ active: open && revealOnOpen, blockRef, getBlockBottom })

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
    const mountedRows = getMountedTransitionRows('data-work-id', workId)
    setRevealOnOpen(!open)
    workExpansion.setOpen(workId, !open, mountedRows)
  }

  return (
    <Button
      ref={blockRef}
      data-slot="work-block"
      data-open={open}
      variant="plain"
      size={null}
      aria-expanded={open}
      aria-label={`${open ? 'Collapse' : 'Expand'} work: ${summary.label}`}
      onClick={toggle}
      className="chat-header-focus chat-summary-row text-muted-foreground flex max-w-full items-center justify-start gap-2 text-left text-xs whitespace-normal focus-visible:ring-0"
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

/** Work details are sibling rows. The last mounted one bounds the visible group. */
function getWorkBottom(trigger: HTMLElement, workId: string) {
  const row = trigger.closest('[data-row-kind="work"]')
  const details = row?.parentElement?.querySelectorAll(
    `[data-work-id="${CSS.escape(workId)}"]`,
  )
  return details && details[details.length - 1]?.getBoundingClientRect().bottom
}

import { Accordion, RippleButton } from '@/components/ui'
import { useNoteExpansion } from '@/hooks/chat/note-expansion'
import type { MessageRow } from '@/lib/chat/rows'
import { StickyNoteIcon } from 'lucide-react'

import { useMessageList } from './message-list/message-list-context'
import { getMountedTransitionRows } from './virtualized-row-transition'

export function NoteGroupBlock({
  row,
}: {
  row: Extract<MessageRow, { kind: 'note-group' }>
}) {
  const [open, onOpenChange] = useNoteExpansion(row.key)
  const list = useMessageList()

  return (
    <RippleButton
      data-slot="note-group-block"
      variant="plain"
      size={null}
      aria-expanded={open}
      aria-label={`${open ? 'Collapse' : 'Expand'} ${row.count} notes`}
      onClick={() => {
        list?.onLayoutChange()
        const mountedRows = getMountedTransitionRows(
          'data-note-group-id',
          row.key,
        )
        onOpenChange(!open, mountedRows)
      }}
      className="text-muted-foreground bg-muted/50 flex min-h-7 w-fit max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
    >
      <StickyNoteIcon className="size-3.5 shrink-0" />
      <span>{row.count} notes</span>
      <Accordion.Icon isExpanded={open} className="shrink-0" />
    </RippleButton>
  )
}

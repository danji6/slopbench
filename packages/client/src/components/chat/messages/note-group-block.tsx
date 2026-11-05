import { Accordion, Button } from '@/components/ui'
import { useNoteExpansion } from '@/hooks/chat/note-expansion'
import type { MessageRow } from '@/lib/chat/rows'

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
    <Button
      data-slot="note-group-block"
      data-open={open}
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
      className="text-muted-foreground flex min-h-9 max-w-full items-center justify-start gap-2 py-1 text-left text-xs whitespace-normal"
    >
      <span className="min-w-0 wrap-anywhere">{row.count} notes</span>
      <Accordion.Icon isExpanded={open} className="shrink-0" />
    </Button>
  )
}

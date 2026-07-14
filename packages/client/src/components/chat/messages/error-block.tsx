import { AlertCircleIcon } from 'lucide-react'

import { CollapsibleBlock } from './collapsible-block'
import { useCollapsible } from './collapsible-store'
import { useMessageList } from './message-list/message-list-context'

export function ErrorBlock({
  messageId,
  error,
}: {
  messageId: string
  error: string
}) {
  const onIntoViewSettle = useMessageList()?.onIntoViewSettle
  const [open, onOpenChange] = useCollapsible(`${messageId}:error`)

  return (
    <CollapsibleBlock
      data-slot="error-block"
      label="Error"
      open={open}
      onOpenChange={onOpenChange}
      onExpand={onIntoViewSettle}
      className="border-destructive/20 bg-destructive/10 min-w-32"
      leadingIcon={
        <AlertCircleIcon className="text-destructive size-3.5 shrink-0" />
      }
    >
      <div className="text-destructive px-4 pt-2 pb-4 text-sm wrap-break-word whitespace-pre-wrap">
        {error}
      </div>
    </CollapsibleBlock>
  )
}

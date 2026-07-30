import type { ReasoningPart } from '@sb/convex/types'

import { CollapsibleBlock } from './collapsible-block'
import { useReasoningOpen } from './reasoning-collapsible'
import { useReasoningLabel } from './reasoning-label'
import { SmoothText } from './smooth-text'

export type ReasoningBlockProps = {
  part: ReasoningPart
  messageId: string
  segmentIndex: number
  groupIndex: number
}

export function ReasoningBlock({
  part,
  messageId,
  segmentIndex,
  groupIndex,
}: ReasoningBlockProps) {
  const { label, isStreaming } = useReasoningLabel(part)
  const [open, onOpenChange] = useReasoningOpen(
    messageId,
    segmentIndex,
    groupIndex,
  )

  if (!part.text) return null

  return (
    <CollapsibleBlock
      data-slot="reasoning-block"
      label={label}
      shimmer={isStreaming}
      open={open}
      onOpenChange={onOpenChange}
      surface
    >
      <div
        className="px-2.5 pb-2.5 wrap-break-word whitespace-pre-wrap opacity-70"
        style={{
          fontFamily: 'var(--chat-font-family)',
          fontSize: 'var(--chat-font-size)',
        }}
      >
        <SmoothText part={part} />
      </div>
    </CollapsibleBlock>
  )
}

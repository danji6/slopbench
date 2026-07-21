import type { ReasoningPart } from '@sb/convex/types'

import { CollapsibleBlock } from './collapsible-block'
import { useReasoningLabel } from './reasoning-label'
import { SmoothText } from './smooth-text'

export function ReasoningBlock({ part }: { part: ReasoningPart }) {
  const { label, isStreaming } = useReasoningLabel(part)

  if (!part.text) return null

  return (
    <CollapsibleBlock
      data-slot="reasoning-block"
      label={label}
      shimmer={isStreaming}
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

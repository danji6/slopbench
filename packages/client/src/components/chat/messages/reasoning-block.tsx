import { useTimer } from '@/hooks/timer'
import { formatDuration } from '@/lib/utils'
import type { ReasoningUIPart } from 'ai'
import { useMemo } from 'react'

import { CollapsibleBlock } from './collapsible-block'
import { SmoothText } from './smooth-text'

export function ReasoningBlock({ part }: { part: ReasoningUIPart }) {
  const isStreaming = part.state === 'streaming'
  const elapsedMs = useTimer(isStreaming)

  const label = useMemo(() => {
    return isStreaming
      ? 'Thinking...'
      : elapsedMs > 0
        ? `Thought for ${formatDuration(elapsedMs)}`
        : 'Thought'
  }, [elapsedMs, isStreaming])

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

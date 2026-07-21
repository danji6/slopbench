import { useTimer } from '@/hooks/timer'
import { formatDuration } from '@/lib/utils'
import type { ReasoningPart } from '@sb/convex/types'
import { useMemo } from 'react'

export function useReasoningLabel(part: ReasoningPart) {
  const isStreaming = part.state === 'streaming'
  const elapsedMs = useTimer(isStreaming)
  const durationMs = part.duration ?? elapsedMs

  const label = useMemo(() => {
    if (isStreaming) return 'Thinking...'
    return durationMs > 0
      ? `Thought for ${formatDuration(durationMs)}`
      : 'Thought'
  }, [durationMs, isStreaming])

  return { label, isStreaming }
}

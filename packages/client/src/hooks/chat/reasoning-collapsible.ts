import { useCollapsible } from '@/hooks/chat/collapsible'

/** Keeps a reasoning block expanded across remounts. */
export function useReasoningOpen(
  messageId: string,
  segmentIndex: number,
  groupIndex: number,
  version = 1,
) {
  return useCollapsible(
    `${messageId}:v${version}:s${segmentIndex}:g${groupIndex}:reasoning`,
  )
}

import { useCollapsible } from './collapsible-store'

/** Keeps a reasoning block expanded across remounts. */
export function useReasoningOpen(
  messageId: string,
  segmentIndex: number,
  groupIndex: number,
) {
  return useCollapsible(
    `${messageId}:s${segmentIndex}:g${groupIndex}:reasoning`,
  )
}

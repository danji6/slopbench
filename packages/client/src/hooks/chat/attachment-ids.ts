import type { UIMessage } from 'ai'
import { isFileUIPart } from 'ai'
import { useMemo } from 'react'

/**
 * Maps each file part's URL to its `attachmentId` so `FileBlock` can resolve a
 * displayable URL via `api.attachments.getUrlMap`. The id now lives on the part
 * itself (native messages), not in a session-level `attachmentMap`.
 */
export function useAttachmentIds(
  message: UIMessage | null | undefined,
): Record<string, string> | undefined {
  return useMemo(() => {
    if (!message) return undefined
    const result: Record<string, string> = {}
    for (const part of message.parts) {
      if (!isFileUIPart(part)) continue
      const attachmentId = (part as { attachmentId?: string }).attachmentId
      if (attachmentId) result[part.url] = attachmentId
    }
    return Object.keys(result).length > 0 ? result : undefined
  }, [message])
}

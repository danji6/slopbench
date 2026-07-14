import type { SourceMessagePart } from '@/lib/chat/combine'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { ToolUIPart } from 'ai'
import { useConvex } from 'convex/react'
import { useCallback, useState } from 'react'

/**
 * Large tool outputs are offloaded to Convex storage and rendered from a small
 * inline preview. This loads the full output on demand to keep collapsed blocks
 * cheap.
 *
 * @returns the preview output until the user triggers `loadFull`.
 */
export function useToolOutput(part: ToolUIPart, messageId: string) {
  const convex = useConvex()
  const outputRef = (part as { outputRef?: string }).outputRef
  const sourceMessageId =
    (part as SourceMessagePart).sourceMessageId ?? messageId

  const [full, setFull] = useState<unknown>(undefined)
  const [loading, setLoading] = useState(false)

  const loadFull = useCallback(() => {
    if (!outputRef || full !== undefined || loading) return
    setLoading(true)
    void (async () => {
      try {
        const url = await convex.query(api.chat.getToolOutputUrl, {
          messageId: sourceMessageId as Id<'messages'>,
          toolCallId: part.toolCallId,
        })
        if (!url) return
        setFull(await (await fetch(url)).json())
      } catch {
        // Keep the preview on failure
      } finally {
        setLoading(false)
      }
    })()
  }, [convex, outputRef, full, loading, sourceMessageId, part.toolCallId])

  return {
    output: full ?? part.output,
    truncated: Boolean(outputRef) && full === undefined,
    loadingFull: loading,
    loadFull,
  }
}

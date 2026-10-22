import type { SourceMessagePart } from '@/lib/chat/combine'
import { readTextPreview } from '@/lib/text-file-preview'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { decodeMcpOutput } from '@sb/core/types/mcp-result'
import type { ToolUIPart } from 'ai'
import { useQuery } from 'convex/react'
import { useEffect, useState } from 'react'

type LoadedToolOutput = {
  reference: string
  value?: unknown
  error?: string
}

/** Loads stored output on demand, fencing stale responses against the current reference. */
export function useToolOutput(part: ToolUIPart, messageId: string) {
  const outputRef = (part as { outputRef?: string }).outputRef
  const sourceMessageId = (part as SourceMessagePart).sourceMessageId ?? messageId // prettier-ignore
  const [attempt, setAttempt] = useState(0)
  const [requested, setRequested] = useState<string>()
  const [loaded, setLoaded] = useState<LoadedToolOutput>()
  const active = !!outputRef && requested === outputRef

  const url = useQuery(
    api.chat.getToolOutputUrl,
    active
      ? {
          messageId: sourceMessageId as Id<'messages'>,
          toolCallId: part.toolCallId,
        }
      : 'skip',
  )

  useEffect(() => {
    if (!active || !url || !outputRef) return

    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) // prettier-ignore

    void loadOutput(url, signal).then(
      (value) => {
        if (!signal.aborted) setLoaded({ reference: outputRef, value })
      },
      () => {
        if (!controller.signal.aborted)
          setLoaded({
            reference: outputRef,
            error: 'Could not load the full output. Try again.',
          })
      },
    )

    return () => controller.abort()
  }, [active, url, outputRef, attempt])

  const result = loaded?.reference === outputRef ? loaded : undefined
  const stored = result?.value ?? part.output

  return {
    output: typeof stored === 'string' ? decodeMcpOutput(stored) : stored,
    truncated: Boolean(outputRef) && result?.value === undefined,
    loadingFull: active && !result && url !== null,
    loadError:
      result?.error ??
      (active && url === null ? 'Full output is unavailable.' : undefined),
    loadFull: () => {
      setLoaded(undefined)
      setRequested(outputRef)
      setAttempt((value) => value + 1)
    },
  }
}

async function loadOutput(url: string, signal: AbortSignal) {
  const preview = await readTextPreview(url, signal, 64 * 1024 * 1024)
  if (preview.truncated)
    throw new Error('Full output exceeds download capacity')
  return JSON.parse(preview.text) as unknown
}

import { useToolOutput } from '@/hooks/chat/tool-output'
import type { ToolUIPart } from 'ai'

import { LoadFullOutput } from './load-full-output'
import { ToolShell } from './tool-shell'

function hostnameOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export function WebFetchBlock({
  part,
  messageId,
  forceError,
}: {
  part: ToolUIPart
  messageId: string
  forceError?: boolean
}) {
  const url = (part.input as { url?: string } | undefined)?.url

  const {
    output: rawOutput,
    truncated,
    loadFull,
    loadingFull,
  } = useToolOutput(part, messageId)

  const output =
    part.state === 'output-available' && typeof rawOutput === 'string'
      ? rawOutput
      : undefined

  return (
    <ToolShell
      part={part}
      messageId={messageId}
      forceError={forceError}
      label={
        <span title={url}>
          Fetch{' '}
          <span className="text-foreground font-medium">
            {hostnameOf(url) ?? '…'}
          </span>
        </span>
      }
    >
      {output && (
        <pre className="bg-background max-h-80 overflow-auto rounded px-2 py-1 text-xs whitespace-pre-wrap">
          {output}
        </pre>
      )}
      {truncated && <LoadFullOutput onLoad={loadFull} loading={loadingFull} />}
    </ToolShell>
  )
}

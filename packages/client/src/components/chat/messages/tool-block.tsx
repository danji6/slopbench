import { useToolOutput } from '@/hooks/chat/tool-output'
import { getToolErrorText } from '@/lib/chat'
import type { ToolUIPart } from 'ai'
import { memo } from 'react'

import { LoadFullOutput } from './tools/load-full-output'
import { ToolShell } from './tools/tool-shell'

/** Generic fallback renderer for tools without a dedicated component. */
export const ToolBlock = memo(
  ({
    part,
    messageId,
    forceError,
  }: {
    part: ToolUIPart
    messageId: string
    forceError?: boolean
  }) => {
    const toolName = part.type.replace('tool-', '')

    const { output, truncated, loadFull, loadingFull } = useToolOutput(
      part,
      messageId,
    )

    const hasInput = Boolean(
      part.input && Object.keys(part.input as object).length > 0,
    )

    const hasOutput =
      part.state === 'output-available' &&
      output !== undefined &&
      !getToolErrorText(part)

    return (
      <ToolShell
        part={part}
        messageId={messageId}
        forceError={forceError}
        label={
          <span className="text-foreground font-medium">
            {part.title || toolName}
          </span>
        }
      >
        {hasInput && (
          <div>
            <div className="text-muted-foreground mb-1 text-xs">Input</div>
            <pre className="bg-background overflow-x-auto rounded px-2 py-1 text-xs">
              {JSON.stringify(part.input as object, null, 2)}
            </pre>
          </div>
        )}
        {hasOutput && (
          <div className="w-full">
            <div className="text-muted-foreground mb-1 text-xs">Output</div>
            <pre className="bg-background overflow-x-auto rounded px-2 py-1 text-xs">
              {typeof output === 'string'
                ? output
                : JSON.stringify(output as object, null, 2)}
            </pre>
            {truncated && (
              <LoadFullOutput onLoad={loadFull} loading={loadingFull} />
            )}
          </div>
        )}
      </ToolShell>
    )
  },
)

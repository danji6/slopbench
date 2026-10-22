import { useToolOutput } from '@/hooks/chat/tool-output'
import { getToolErrorText } from '@/lib/chat'
import type { McpProgress as Progress } from '@sb/core/types/mcp-operation'
import { isMcpResult } from '@sb/core/types/mcp-result'
import type { ToolUIPart } from 'ai'
import { memo } from 'react'

import { LoadFullOutput } from './tools/load-full-output'
import { McpProgress } from './tools/mcp-progress'
import { McpResultContent, mcpReportedError } from './tools/mcp-result-content'
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

    const { output, truncated, loadFull, loadingFull, loadError } =
      useToolOutput(part, messageId)

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
        forceError={forceError || mcpReportedError(output)}
        footer={
          <McpProgress
            progress={(part as { mcpProgress?: Progress }).mcpProgress}
          />
        }
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
            {isMcpResult(output) ? (
              <McpResultContent output={output} />
            ) : (
              <pre className="bg-background overflow-x-auto rounded px-2 py-1 text-xs">
                {typeof output === 'string'
                  ? output
                  : JSON.stringify(output as object, null, 2)}
              </pre>
            )}
            {loadError && (
              <p className="text-destructive text-xs" role="alert">
                {loadError}
              </p>
            )}
            {truncated && (
              <LoadFullOutput onLoad={loadFull} loading={loadingFull} />
            )}
          </div>
        )}
      </ToolShell>
    )
  },
)

import { createOptionalContext } from '@/hooks'
import { isToolInFlight } from '@/lib/chat'
import { type ShellReportPart, isShellReportPart } from '@/lib/chat/parts'
import type { ToolUIPart } from 'ai'
import { useCallback, useMemo, useState } from 'react'

import { CollapsibleBlock } from '../collapsible-block'
import { ShellReportBlock } from '../shell-report-block'
import { ShellBlock } from './shell-block'
import { ToolIcon } from './tool-icon'

export type ShellGroupState = {
  reportRunning: (id: string, running: boolean) => void
}

const [ShellGroupContext, useShellGroup] =
  createOptionalContext<ShellGroupState>()

export { useShellGroup }

type ShellGroupBlockProps = {
  parts: Array<ToolUIPart | ShellReportPart>
  messageId: string
  toolErrors?: string[]
  alwaysExpand?: boolean
}

/** Groups shell commands, output polls, and background completion reports. */
export function ShellGroupBlock({
  parts,
  messageId,
  toolErrors,
  alwaysExpand,
}: ShellGroupBlockProps) {
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set())

  const reportRunning = useCallback((id: string, isRunning: boolean) => {
    setRunning((prev) => {
      if (prev.has(id) === isRunning) return prev
      const next = new Set(prev)
      if (isRunning) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const state = useMemo(() => ({ reportRunning }), [reportRunning])

  const inFlight =
    running.size > 0 ||
    parts.some((part) => !isShellReportPart(part) && isToolInFlight(part))
  const outputOnly = parts.every((part) => part.type === 'tool-shell_output')
  const noun = outputOnly ? 'command output' : 'command'

  return (
    <ShellGroupContext.Provider value={state}>
      <CollapsibleBlock
        data-slot="shell-group"
        collapsible={false}
        dense
        fullWidth
        leadingIcon={<ToolIcon name="shell" />}
        label={
          <>
            {outputOnly ? 'Read' : inFlight ? 'Running' : 'Ran'}{' '}
            <span className="text-foreground font-medium">
              {parts.length} {noun}
              {parts.length === 1 ? '' : 's'}
            </span>
          </>
        }
      >
        <div className="border-border/60 ml-4 flex flex-col gap-0.5 border-l">
          {parts.map((part) =>
            isShellReportPart(part) ? (
              <ShellReportBlock key={part.jobId} part={part} />
            ) : (
              <ShellBlock
                key={part.toolCallId}
                part={part}
                messageId={messageId}
                forceError={toolErrors?.includes(part.toolCallId)}
                dense
                alwaysExpand={alwaysExpand}
              />
            ),
          )}
        </div>
      </CollapsibleBlock>
    </ShellGroupContext.Provider>
  )
}

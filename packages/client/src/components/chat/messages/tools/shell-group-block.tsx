import { createOptionalContext } from '@/hooks'
import { isToolInFlight } from '@/lib/chat'
import { type ShellReportPart, isShellReportPart } from '@/lib/chat/parts'
import type { ToolUIPart } from 'ai'
import { useCallback, useMemo, useState } from 'react'

import { CollapsibleBlock } from '../collapsible-block'
import { ShellReportBlock } from '../shell-report-block'
import { ShellBlock } from './shell-block'
import { ToolIcon } from './tool-icon'
import { ToolList, ToolListItem } from './tool-list'

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

/** Groups shell commands and background completion reports. */
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
            {inFlight ? 'Running' : 'Ran'}{' '}
            <span className="text-foreground font-medium">
              {parts.length} command
              {parts.length === 1 ? '' : 's'}
            </span>
          </>
        }
      >
        <ToolList className="[--tool-list-gap:var(--work-command-gap)]">
          {parts.map((part, index) => (
            <ToolListItem
              key={isShellReportPart(part) ? part.jobId : part.toolCallId}
              last={index === parts.length - 1}
            >
              {isShellReportPart(part) ? (
                <ShellReportBlock part={part} />
              ) : (
                <ShellBlock
                  part={part}
                  messageId={messageId}
                  forceError={toolErrors?.includes(part.toolCallId)}
                  dense
                  alwaysExpand={alwaysExpand}
                />
              )}
            </ToolListItem>
          ))}
        </ToolList>
      </CollapsibleBlock>
    </ShellGroupContext.Provider>
  )
}

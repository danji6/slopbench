import { createOptionalContext } from '@/hooks'
import type { ToolUIPart } from 'ai'
import { SquareTerminalIcon } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'

import { CollapsibleBlock } from '../collapsible-block'
import { ShellBlock } from './shell-block'

export type ShellGroupState = {
  reportRunning: (id: string, running: boolean) => void
}

const [ShellGroupContext, useShellGroup] =
  createOptionalContext<ShellGroupState>()

export { useShellGroup }

/** Renders one or more consecutive `shell` calls as a single grouped run. */
export function ShellGroupBlock({
  parts,
  messageId,
  toolErrors,
}: {
  parts: ToolUIPart[]
  messageId: string
  toolErrors?: string[]
}) {
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

  return (
    <ShellGroupContext.Provider value={state}>
      <CollapsibleBlock
        data-slot="shell-group"
        collapsible={false}
        fullWidth
        leadingIcon={<SquareTerminalIcon className="size-3.5 shrink-0" />}
        label={
          <>
            {running.size === 0 ? 'Ran' : 'Running'}{' '}
            <span className="text-foreground font-medium">
              {parts.length} {parts.length === 1 ? 'command' : 'commands'}
            </span>
          </>
        }
      >
        <div className="border-border/60 ml-3.5 flex flex-col gap-0.5 border-l pb-2.5 pl-2">
          {parts.map((part) => (
            <ShellBlock
              key={part.toolCallId}
              part={part}
              messageId={messageId}
              forceError={toolErrors?.includes(part.toolCallId)}
              dense
            />
          ))}
        </div>
      </CollapsibleBlock>
    </ShellGroupContext.Provider>
  )
}

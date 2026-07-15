import type { ToolUIPart } from 'ai'
import { SquareTerminalIcon } from 'lucide-react'

import { CollapsibleBlock } from '../collapsible-block'
import { ShellBlock } from './shell-block'

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
  return (
    <CollapsibleBlock
      data-slot="shell-group"
      collapsible={false}
      fullWidth
      leadingIcon={<SquareTerminalIcon className="size-3.5 shrink-0" />}
      label={
        <>
          Ran{' '}
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
  )
}

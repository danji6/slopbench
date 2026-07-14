import type { ToolUIPart } from 'ai'
import { SquareTerminalIcon } from 'lucide-react'

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
  if (parts.length === 1) {
    return (
      <ShellBlock
        part={parts[0]}
        messageId={messageId}
        forceError={toolErrors?.includes(parts[0].toolCallId)}
      />
    )
  }

  return (
    <div data-slot="shell-group" className="w-full">
      <div className="text-muted-foreground mb-1 flex items-center gap-1.5 px-2.5 text-xs">
        <SquareTerminalIcon className="size-3.5 shrink-0" />
        <span>{parts.length} commands</span>
      </div>
      <div className="border-border/60 ml-3.5 flex flex-col gap-0.5 border-l pl-2">
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
    </div>
  )
}

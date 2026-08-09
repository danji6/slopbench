import type { ShellReportPart } from '@/lib/chat/parts'
import { SquareTerminalIcon } from 'lucide-react'

import { CollapsibleBlock } from './collapsible-block'
import { useCollapsible } from './collapsible-store'
import { HighlightedCommand } from './tools/highlighted-command'

const STATUS_LABELS: Record<ShellReportPart['status'], string> = {
  done: 'done',
  killed: 'killed',
  timeout: 'timed out',
  lost: 'lost',
  failed: 'failed',
}

/** A background shell job's result, shown after its tool call settled. */
export function ShellReportBlock({ part }: { part: ShellReportPart }) {
  const [open, onOpenChange] = useCollapsible(`shell-report:${part.jobId}`)

  return (
    <CollapsibleBlock
      data-slot="shell-report-block"
      open={open}
      onOpenChange={onOpenChange}
      surface
      leadingIcon={
        <SquareTerminalIcon className="text-muted-foreground size-3.5 shrink-0" />
      }
      label={
        <span className="font-mono">
          <span className="text-foreground/70">$</span>{' '}
          <HighlightedCommand command={part.command} />
          <span className="text-muted-foreground ml-2 text-[10px] uppercase">
            {STATUS_LABELS[part.status]}
            {part.exitCode != null &&
              part.exitCode !== 0 &&
              ` · ${part.exitCode}`}
          </span>
        </span>
      }
      className="px-2 pt-1.5 pb-2"
    >
      <pre className="max-h-72 overflow-auto px-2.5 pb-1 font-mono text-xs whitespace-pre-wrap">
        {part.text}
      </pre>
    </CollapsibleBlock>
  )
}

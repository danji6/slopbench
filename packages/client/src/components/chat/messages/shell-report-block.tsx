import { useCollapsible } from '@/hooks/chat/collapsible'
import type { ShellReportPart } from '@/lib/chat/parts'

import { CollapsibleBlock } from './collapsible-block'
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
      dense
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
      className="px-0 data-[open=true]:my-1 data-[open=true]:py-2"
    >
      <pre className="max-h-72 overflow-auto px-2.5 pb-1 font-mono text-xs whitespace-pre-wrap">
        {part.text}
      </pre>
    </CollapsibleBlock>
  )
}

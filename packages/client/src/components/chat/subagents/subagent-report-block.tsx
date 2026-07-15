import type { SubagentReportPart } from '@/lib/chat/parts'
import { BotIcon, ExternalLinkIcon } from 'lucide-react'
import { useLocation } from 'wouter'

const STATUS_LABELS: Record<SubagentReportPart['status'], string> = {
  complete: 'done',
  failed: 'failed',
  stopped: 'stopped',
}

/**
 * Compact chip for a sub-agent report delivered to the parent transcript.
 * Clicking it opens the child session.
 */
export function SubagentReportBlock({ part }: { part: SubagentReportPart }) {
  const [, navigate] = useLocation()

  return (
    <button
      type="button"
      data-slot="subagent-report-block"
      onClick={() => navigate(`/?id=${part.sessionId}`)}
      title="Open the sub-agent session"
      className="bg-m3-surface-container text-muted-foreground hover:text-foreground group mb-1 inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 align-middle font-mono text-xs transition-colors"
    >
      <BotIcon className="size-3.5 shrink-0" />
      <span className="truncate">
        Report from {part.agentName}
        {part.title && ` • ${part.title}`}
      </span>
      <span className="shrink-0">({STATUS_LABELS[part.status]})</span>
      <ExternalLinkIcon className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>
  )
}

import { NotebookPenIcon } from 'lucide-react'

export type PlanLinkBlockProps = {
  status: 'draft' | 'approved'
}

/** Compact chip for a plan snapshot carried into the transcript. */
export function PlanLinkBlock({ status }: PlanLinkBlockProps) {
  return (
    <span
      data-slot="plan-link-block"
      className="bg-m3-surface-container text-muted-foreground mb-1 inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 align-middle font-mono text-xs"
      title="Session plan snapshot"
    >
      <NotebookPenIcon className="size-3.5 shrink-0" />
      <span className="truncate">Plan ({status})</span>
    </span>
  )
}

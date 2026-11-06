import { AlertCircle } from 'lucide-react'

import { CollapsibleBlock } from '../collapsible-block'

type ChangeNoticeProps = {
  warning?: boolean
  message: string
  details?: string[]
  role?: 'alert' | 'status'
}

/** Keeps diagnostics compact while preserving the complete message on expansion. */
export function ChangeNotice({
  message,
  details = [],
  role = 'alert',
  warning = false,
}: ChangeNoticeProps) {
  const tone = warning
    ? 'text-amber-700 dark:text-amber-400'
    : 'text-destructive'
  return (
    <CollapsibleBlock
      role={role}
      label={[message, ...details].join(' ')}
      labelClassName={`${tone} truncate`}
      leadingIcon={
        <AlertCircle
          aria-hidden
          className={`${tone} size-3.5 shrink-0 -translate-y-px`}
        />
      }
      fullWidth
      dense
      bodyClassName="px-4 pt-1 pb-3"
      revealOnOpen={false}
      className={`mt-3 rounded-md ${warning ? 'border-amber-500/15 bg-amber-500/5' : 'border-destructive/15 bg-destructive/5'}`}
    >
      <div
        className={`${tone} max-h-64 overflow-y-auto text-xs wrap-anywhere whitespace-pre-wrap select-text`}
      >
        <p>{message}</p>
        {details.map((detail, index) => (
          <p key={index} className="mt-2 font-mono">
            {detail}
          </p>
        ))}
      </div>
    </CollapsibleBlock>
  )
}

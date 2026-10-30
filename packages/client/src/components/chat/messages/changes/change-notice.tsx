import { AlertCircle } from 'lucide-react'

import { CollapsibleBlock } from '../collapsible-block'

type ChangeNoticeProps = {
  message: string
  details?: string[]
  role?: 'alert' | 'status'
}

/** Keeps diagnostics compact while preserving the complete message on expansion. */
export function ChangeNotice({
  message,
  details = [],
  role = 'alert',
}: ChangeNoticeProps) {
  return (
    <CollapsibleBlock
      role={role}
      label={[message, ...details].join(' ')}
      labelClassName="text-destructive truncate"
      leadingIcon={
        <AlertCircle
          aria-hidden
          className="text-destructive size-3.5 shrink-0"
        />
      }
      fullWidth
      dense
      revealOnOpen={false}
      className="border-destructive/15 bg-destructive/5 mt-3 rounded-md"
    >
      <div className="text-destructive max-h-64 overflow-y-auto px-4 pt-1 pb-3 text-xs wrap-anywhere whitespace-pre-wrap select-text">
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

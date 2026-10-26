import type { ReactNode } from 'react'

import { ExpandableDescription } from './expandable-description'

type SelectionListItemProps = {
  label: string
  added?: boolean
  description?: string
  actions: ReactNode
  children?: ReactNode
}

/** Wraps selection labels and actions within narrow settings panels. */
export function SelectionListItem({
  label,
  added,
  description,
  actions,
  children,
}: SelectionListItemProps) {
  return (
    <div
      role="listitem"
      className="border-border flex min-w-0 flex-wrap items-start gap-3 border-b py-3"
    >
      <div className="min-w-0 flex-1 basis-40">
        <p className="font-medium wrap-anywhere">
          <span>{label}</span>
          {added && (
            <span className="text-primary ml-2 text-sm font-bold">(Added)</span>
          )}
        </p>
        {children}
        {description && <ExpandableDescription description={description} />}
      </div>
      <div className="flex max-w-full shrink-0 flex-wrap items-center gap-3">
        {actions}
      </div>
    </div>
  )
}

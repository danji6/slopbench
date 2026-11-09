import { cn } from '@/lib/utils'

import { RippleButton } from '../../ui'

type ReviewApprovalButtonProps = {
  onClick: () => void
  compact?: boolean
  className?: string
  onFocus?: React.FocusEventHandler<HTMLDivElement>
  onBlur?: React.FocusEventHandler<HTMLDivElement>
}

export function ReviewApprovalButton({
  onClick,
  compact = false,
  className,
  onFocus,
  onBlur,
}: ReviewApprovalButtonProps) {
  const notice = 'Agent is waiting for a decision'

  return (
    <div
      data-slot="review-approval"
      className={cn('flex items-center justify-between gap-2', className)}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <span
        role="status"
        className={compact ? 'sr-only' : 'text-muted-foreground text-xs'}
      >
        {notice}
      </span>
      <RippleButton
        size={compact ? 'default' : 'sm'}
        variant="tertiary"
        title={compact ? notice : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
      >
        Review approval
      </RippleButton>
    </div>
  )
}

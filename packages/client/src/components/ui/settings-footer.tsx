import { cn } from '@/lib/utils'

import { ConfirmDialog } from './confirm-dialog'
import { RippleButton, type RippleButtonProps } from './ripple-button'

export type SettingsFooterProps = {
  /** Whether the form has unsaved changes. */
  isDirty: boolean
  /** Close without changes (Close while clean). */
  onClose: () => void
  /** Discard changes and close (confirmed Cancel while dirty). */
  onDiscard: () => void
  /** Persist and close. Apply (persist only) is the enclosing form's submit. */
  onSave: () => void
  /** Whether a save is in flight. */
  busy?: boolean
  /** New records may require an explicit Save instead of Apply. */
  showApply?: boolean
  className?: string
}

/**
 * Show Close for clean drafts and Cancel / Apply / Save for unsaved changes. Must be
 * rendered inside the `<form>` so Apply can submit it (persist without closing).
 */
export function SettingsFooter({
  isDirty,
  onClose,
  onDiscard,
  onSave,
  busy = false,
  showApply = true,
  className,
}: SettingsFooterProps) {
  return (
    <div
      className={cn(
        'border-border flex justify-end gap-2 border-t px-4 py-3',
        className,
      )}
    >
      {isDirty && !busy ? (
        <ConfirmDialog
          variant="destructive"
          title="Discard changes?"
          description="Your unsaved changes will be lost."
          confirmText="Discard"
          cancelText="Keep editing"
          onConfirm={onDiscard}
        >
          <FooterButton variant="input">Cancel</FooterButton>
        </ConfirmDialog>
      ) : (
        <FooterButton
          variant="input"
          type="button"
          onClick={onClose}
          disabled={busy}
          className="max-w-32 min-w-0 flex-1"
        >
          {isDirty ? 'Cancel' : 'Close'}
        </FooterButton>
      )}
      {isDirty && showApply && (
        <FooterButton
          variant="outline"
          type="submit"
          disabled={busy}
          className="max-w-32 min-w-0 flex-1"
        >
          Apply
        </FooterButton>
      )}
      {isDirty && (
        <FooterButton
          variant="primary"
          type="button"
          onClick={onSave}
          disabled={busy}
          className="max-w-32 min-w-0 flex-1"
        >
          Save
        </FooterButton>
      )}
    </div>
  )
}

function FooterButton(props: RippleButtonProps) {
  return <RippleButton variant="primary" className="min-w-32" {...props} />
}

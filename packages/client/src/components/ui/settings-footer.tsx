import { cn } from '@/lib/utils'

import { ConfirmDialog } from './confirm-dialog'
import { RippleButton, type RippleButtonProps } from './ripple-button'

export type SettingsFooterProps = {
  /** Whether the form has unsaved changes. */
  isDirty: boolean
  /** Close without changes (Cancel while clean). */
  onClose: () => void
  /** Discard changes and close (confirmed Cancel while dirty). */
  onDiscard: () => void
  /** Persist and close. Apply (persist only) is the enclosing form's submit. */
  onSave: () => void
  className?: string
}

/**
 * Shared Cancel / Apply / Save footer for settings-style dialogs. Must be
 * rendered inside the `<form>` so Apply can submit it (persist without closing).
 */
export function SettingsFooter({
  isDirty,
  onClose,
  onDiscard,
  onSave,
  className,
}: SettingsFooterProps) {
  return (
    <div
      className={cn(
        'border-border flex justify-end gap-2 border-t px-4 py-3',
        className,
      )}
    >
      {isDirty ? (
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
          className="max-w-32 min-w-0 flex-1"
        >
          Cancel
        </FooterButton>
      )}
      <FooterButton
        variant={isDirty ? 'outline' : 'surface'}
        type="submit"
        disabled={!isDirty}
        className="max-w-32 min-w-0 flex-1"
      >
        Apply
      </FooterButton>
      <FooterButton
        variant={isDirty ? 'primary' : 'surface'}
        type="button"
        onClick={onSave}
        disabled={!isDirty}
        className="max-w-32 min-w-0 flex-1"
      >
        Save
      </FooterButton>
    </div>
  )
}

function FooterButton(props: RippleButtonProps) {
  return <RippleButton variant="primary" className="min-w-32" {...props} />
}

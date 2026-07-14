
import type { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog'
import { useState } from 'react'

import { AlertDialog } from './alert-dialog'
import type { ButtonProps } from './button'

export type ConfirmDialogAction = {
  text: string
  onConfirm?: () => void
  variant?: ButtonProps['variant']
}

export type ConfirmDialogProps = Omit<
  AlertDialogPrimitive.Popup.Props,
  'children'
> & {
  variant?: ButtonProps['variant']
  title?: React.ReactNode
  description?: React.ReactNode
  confirmText?: string
  cancelText?: string
  onConfirm?: () => void
  onCancel?: () => void
  /** Optional second action rendered between Cancel and the primary action. */
  extraAction?: ConfirmDialogAction
  open?: boolean
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
  children?: React.ReactElement
}

export function ConfirmDialog({
  variant = 'primary',
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  extraAction,
  open,
  onOpenChange,
  disabled,
  children,
  ...props
}: ConfirmDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const openState = open ?? internalOpen

  function handleOpenChange(value: boolean) {
    setInternalOpen(value)
    onOpenChange?.(value)
  }

  function handleCancel() {
    onCancel?.()
    handleOpenChange(false)
  }

  function handleConfirm() {
    onConfirm?.()
    handleOpenChange(false)
  }

  if (disabled) {
    return children
  }

  return (
    <AlertDialog open={openState} onOpenChange={handleOpenChange}>
      {children && <AlertDialog.Trigger render={children} />}
      <AlertDialog.Content {...props}>
        {(title || description) && (
          <AlertDialog.Header>
            {title && <AlertDialog.Title>{title}</AlertDialog.Title>}
            {description && (
              <AlertDialog.Description>{description}</AlertDialog.Description>
            )}
          </AlertDialog.Header>
        )}
        <AlertDialog.Footer className={extraAction ? undefined : 'grid grid-cols-2'}>
          <AlertDialog.Cancel onClick={handleCancel}>
            {cancelText}
          </AlertDialog.Cancel>
          {extraAction && (
            <AlertDialog.Action
              variant={extraAction.variant ?? variant}
              onClick={() => {
                extraAction.onConfirm?.()
                handleOpenChange(false)
              }}
            >
              {extraAction.text}
            </AlertDialog.Action>
          )}
          <AlertDialog.Action variant={variant} onClick={handleConfirm}>
            {confirmText}
          </AlertDialog.Action>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog>
  )
}

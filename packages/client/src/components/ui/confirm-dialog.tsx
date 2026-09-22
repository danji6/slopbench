import { cn } from '@/lib/utils'
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
  /** Stacking order of the dialog and its backdrop. */
  layer?: number
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onOpenChangeComplete?: (open: boolean) => void
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
  onOpenChangeComplete,
  disabled,
  children,
  className,
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
    <AlertDialog
      open={openState}
      onOpenChange={handleOpenChange}
      onOpenChangeComplete={onOpenChangeComplete}
    >
      {children && <AlertDialog.Trigger render={children} />}
      <AlertDialog.Content
        className={cn(
          extraAction && 'data-[size=default]:sm:max-w-md',
          className,
        )}
        {...props}
      >
        {(title || description) && (
          <AlertDialog.Header>
            {title && <AlertDialog.Title>{title}</AlertDialog.Title>}
            {description && (
              <AlertDialog.Description>{description}</AlertDialog.Description>
            )}
          </AlertDialog.Header>
        )}
        <AlertDialog.Footer
          className={
            extraAction ? 'grid grid-cols-2 sm:grid-cols-3' : 'grid grid-cols-2'
          }
        >
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
          <AlertDialog.Action
            variant={variant}
            className={
              extraAction
                ? 'col-span-2 w-[calc(50%-0.25rem)] justify-self-center sm:col-span-1 sm:w-auto sm:justify-self-stretch'
                : undefined
            }
            onClick={handleConfirm}
          >
            {confirmText}
          </AlertDialog.Action>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog>
  )
}

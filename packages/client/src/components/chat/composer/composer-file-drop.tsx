import type { DropZoneHandle } from '@/components/ui/file-picker'
import { Overlay } from '@/components/ui/overlay'
import { fromEvent } from 'file-selector'
import { UploadIcon } from 'lucide-react'
import { useEffect, useEffectEvent, useState } from 'react'
import type { RefObject } from 'react'

type ComposerFileDropProps = {
  disabled: boolean
  draftKey?: string
  pickerRef: RefObject<DropZoneHandle | null>
  onDrop: (files: Promise<File[]>) => void
}

const FILE_PICKER = '[data-slot="file-picker"]'

const MODAL = '[role="dialog"], [role="alertdialog"]'

const MODAL_BACKDROP = [
  '[data-slot="dialog-overlay"]',
  '[data-slot="alert-dialog-overlay"]',
  '[data-slot="sheet-overlay"]',
  '[data-slot="drawer-overlay"]',
].join(', ')

function hasFiles(event: DragEvent): boolean {
  const transfer = event.dataTransfer
  if (!transfer) return false
  return (
    transfer.types.includes('Files') ||
    transfer.types.includes('application/x-moz-file') ||
    Array.from(transfer.items).some((item) => item.kind === 'file')
  )
}

function dropTarget(event: DragEvent, input: HTMLInputElement | null) {
  const target = event.target
  if (!(target instanceof Element)) return 'blocked'

  const picker = target.closest(FILE_PICKER)
  if (picker && !picker.contains(input)) return 'local'
  if (target.closest(MODAL_BACKDROP)) return 'blocked'

  const modal = target.closest(MODAL)
  if (modal) {
    const expandedComposer = input?.closest('[data-slot="fullscreen-overlay"]')
    return expandedComposer?.contains(target) ? 'composer' : 'blocked'
  }

  const focusedModal = document.activeElement?.closest('[aria-modal="true"]')
  return focusedModal ? 'blocked' : 'composer'
}

/** Listen outside the dock so file drops work over the chat and its sidebars. */
export function ComposerFileDrop({
  disabled,
  draftKey,
  pickerRef,
  onDrop,
}: ComposerFileDropProps) {
  const [dragging, setDragging] = useState(false)
  const attach = useEffectEvent(onDrop)

  useEffect(() => {
    let activeTarget: EventTarget | null = null

    function clear() {
      if (!activeTarget) return
      activeTarget = null
      setDragging(false)
    }

    function handleDrag(event: DragEvent) {
      if (!hasFiles(event)) return
      const target = dropTarget(event, pickerRef.current?.input ?? null)
      if (target === 'local') return clear()

      event.preventDefault()
      if (disabled || target === 'blocked') return clear()

      // Keep file drags from showing the editor's text insertion cursor.
      event.stopPropagation()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      activeTarget = event.target
      setDragging(true)
    }

    function handleLeave(event: DragEvent) {
      // Entering a new child precedes leaving the old one.
      if (activeTarget === event.target) clear()
    }

    function handleDrop(event: DragEvent) {
      clear()
      if (!hasFiles(event)) return
      const target = dropTarget(event, pickerRef.current?.input ?? null)
      if (target === 'local') return

      event.preventDefault()
      if (disabled || target === 'blocked') return

      event.stopPropagation()
      // Start reading before the browser locks access to the drop data.
      attach(
        fromEvent(event).then((items) =>
          items.filter((item) => item instanceof File),
        ),
      )
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') clear()
    }

    document.addEventListener('dragenter', handleDrag, true)
    document.addEventListener('dragover', handleDrag, true)
    document.addEventListener('dragleave', handleLeave, true)
    document.addEventListener('drop', handleDrop, true)
    document.addEventListener('dragend', clear, true)
    window.addEventListener('blur', clear)
    window.addEventListener('keydown', handleKey)

    return () => {
      document.removeEventListener('dragenter', handleDrag, true)
      document.removeEventListener('dragover', handleDrag, true)
      document.removeEventListener('dragleave', handleLeave, true)
      document.removeEventListener('drop', handleDrop, true)
      document.removeEventListener('dragend', clear, true)
      window.removeEventListener('blur', clear)
      window.removeEventListener('keydown', handleKey)
      clear()
    }
  }, [disabled, draftKey, pickerRef])

  return (
    <Overlay
      show={dragging && !disabled}
      data-slot="composer-file-drop"
      className="bg-m3-surface-container-low/50 text-m3-on-surface outline-ring pointer-events-none z-39 rounded-3xl outline-2 outline-offset-1 backdrop-blur-sm outline-dashed select-none"
    >
      <span className="flex flex-col items-center gap-2 font-medium">
        <UploadIcon />
        Drop to upload
      </span>
    </Overlay>
  )
}

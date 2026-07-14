import { Dialog, Input, RippleButton } from '@/components/ui'
import { Loader2Icon, SparklesIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface RenameDialogProps {
  show: boolean
  initialValue?: string
  onClose: () => void
  onConfirm: (title: string) => void
  onRegenerate?: () => Promise<string | null | undefined>
}

export function SessionTitleEditor({
  show,
  initialValue,
  onClose,
  onConfirm,
  onRegenerate,
}: RenameDialogProps) {
  const [value, setValue] = useState(initialValue ?? '')
  const [isRegenerating, setIsRegenerating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const didFocusRef = useRef(false)

  useEffect(() => {
    if (!show || !value || didFocusRef.current) return
    const id = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
      didFocusRef.current = true
    }, 0)
    return () => clearTimeout(id)
  }, [show, value])

  async function handleRegenerate() {
    if (!onRegenerate) return
    setIsRegenerating(true)
    try {
      const newTitle = await onRegenerate()
      if (newTitle) setValue(newTitle)
    } finally {
      setIsRegenerating(false)
    }
  }

  return (
    <Dialog open={show} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content showCloseButton={false}>
        <Dialog.Header>
          <Dialog.Title>Rename Session</Dialog.Title>
        </Dialog.Header>
        <div className="py-4">
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onConfirm(value)
              if (e.key === 'Escape') onClose()
            }}
            disabled={isRegenerating}
            className="h-9 text-sm"
            data-vaul-no-drag
          />
        </div>
        <Dialog.Footer>
          {onRegenerate && (
            <RippleButton
              variant="surface"
              onClick={handleRegenerate}
              disabled={isRegenerating}
              className="mr-auto"
            >
              {isRegenerating ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <SparklesIcon className="size-4" />
              )}
              Regenerate
            </RippleButton>
          )}
          <RippleButton
            variant="surface"
            onClick={onClose}
            disabled={isRegenerating}
          >
            Cancel
          </RippleButton>
          <RippleButton
            variant="primary"
            onClick={() => onConfirm(value)}
            disabled={isRegenerating}
          >
            Save
          </RippleButton>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  )
}

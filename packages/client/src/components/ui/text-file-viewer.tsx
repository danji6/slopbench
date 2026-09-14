import type { FileItem } from '@/hooks/file-previews'
import { languageFromPath } from '@/lib/chat/tool-output'
import { extractErrorMessage } from '@/lib/errors'
import { type TextPreview, readTextPreview } from '@/lib/text-file-preview'
import { formatByteLength } from '@sb/core/utils/size'
import { useEffect, useState } from 'react'

import { Code } from './code'
import { Dialog } from './dialog'
import { LoadingIndicator } from './loading-indicator'
import { RippleButton } from './ripple-button'

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | ({ status: 'loaded' } & TextPreview)
  | { status: 'error'; message: string }

/** Opens a preview for a text attachment. */
export function TextFileViewer({
  item,
  children,
}: {
  item: FileItem
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' })
  const sourceUrl = item.originalUrl ?? item.url

  useEffect(() => {
    if (!open) return

    const controller = new AbortController()
    void readTextPreview(sourceUrl, controller.signal)
      .then((result) => setPreview({ status: 'loaded', ...result }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setPreview({ status: 'error', message: extractErrorMessage(error) })
      })

    return () => controller.abort()
  }, [attempt, open, sourceUrl])

  const retry = () => {
    setPreview({ status: 'loading' })
    setAttempt((value) => value + 1)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen && !open) retry()
      }}
    >
      <Dialog.Trigger
        aria-label={`Preview ${item.file.name}`}
        className="focus-visible:ring-ring size-full cursor-pointer rounded-lg text-left outline-none focus-visible:ring-2"
      >
        {children}
      </Dialog.Trigger>
      <Dialog.Content className="grid h-[min(90svh,56rem)] max-w-[min(96vw,80rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0">
        <Dialog.Header className="border-border border-b px-6 py-5 pr-16">
          <Dialog.Title className="truncate">{item.file.name}</Dialog.Title>
          <Dialog.Description className="text-muted-foreground">
            {fileDescription(item)}
          </Dialog.Description>
        </Dialog.Header>
        <TextPreviewBody
          preview={preview}
          filename={item.file.name}
          onRetry={retry}
        />
        {preview.status === 'loaded' && preview.truncated && (
          <p className="border-border text-muted-foreground border-t px-6 py-3 text-xs">
            Showing the first {formatByteLength(preview.shownBytes)}. Download
            the attachment to view the rest.
          </p>
        )}
      </Dialog.Content>
    </Dialog>
  )
}

function TextPreviewBody({
  preview,
  filename,
  onRetry,
}: {
  preview: PreviewState
  filename: string
  onRetry: () => void
}) {
  if (preview.status === 'idle' || preview.status === 'loading') {
    return (
      <div className="flex min-h-0 items-center justify-center">
        <LoadingIndicator />
      </div>
    )
  }

  if (preview.status === 'error') {
    return (
      <div className="flex min-h-0 flex-col items-center justify-center gap-4 p-8 text-center">
        <div>
          <p className="font-medium">Couldn’t load the text preview</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {preview.message}
          </p>
        </div>
        <RippleButton variant="surface" onClick={onRetry}>
          Try again
        </RippleButton>
      </div>
    )
  }

  if (!preview.text) {
    return (
      <p className="text-muted-foreground flex min-h-0 items-center justify-center text-sm">
        This file is empty.
      </p>
    )
  }

  return (
    <Code
      text={preview.text}
      language={languageFromPath(filename) ?? 'text'}
      lineNumbers
      hugParent
      className="h-full min-h-0 rounded-none"
      innerClassName="h-full p-4 text-xs"
      noLoadingIndicator
    />
  )
}

function fileDescription(item: FileItem): string {
  const bytes = item.byteLength ?? item.file.size
  const details = [
    bytes > 0 ? formatByteLength(bytes) : null,
    item.file.type || null,
  ]
  return details.filter(Boolean).join(' · ') || 'Text attachment'
}

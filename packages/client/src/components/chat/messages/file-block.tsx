import { useAttachmentUrls } from '@/hooks/chat'
import { buildFileItemFromPart } from '@/lib/chat'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { FileUIPart } from 'ai'
import { useMemo } from 'react'

import { FileStrip } from '../../ui'

export type FileBlockProps = {
  parts: FileUIPart[]
  attachmentIds?: Record<string, string>
}

export function FileBlock({ parts, attachmentIds }: FileBlockProps) {
  const ids = useMemo(
    () =>
      attachmentIds
        ? (Object.values(attachmentIds) as Id<'attachments'>[])
        : [],
    [attachmentIds],
  )
  const urls = useAttachmentUrls(ids)

  const files = useMemo(
    () =>
      parts.map((part) => {
        const attachmentId = attachmentIds?.[part.url]
        const resolved = attachmentId ? urls[attachmentId] : undefined
        return buildFileItemFromPart(
          part,
          resolved?.url ?? undefined,
          resolved?.previewUrl ?? undefined,
        )
      }),
    [parts, attachmentIds, urls],
  )

  return (
    <FileStrip
      data-slot="file-block"
      files={files}
      size={128}
      className="mb-2 p-0"
      noAnimation
    />
  )
}

import { useAttachmentUrls } from '@/hooks/chat'
import { buildFileItemFromPart } from '@/lib/chat'
import { getAttachmentSendPreview } from '@/lib/chat/attachment-send-previews'
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
      parts.map((part, index) => {
        const attachmentId = attachmentIds?.[part.url]
        const resolved = attachmentId ? urls[attachmentId] : undefined
        const local = attachmentId
          ? getAttachmentSendPreview(attachmentId)
          : undefined
        const file = buildFileItemFromPart(
          part,
          `${index}:${attachmentId ?? part.url}`,
          resolved?.url ?? undefined,
          resolved?.previewUrl ?? local?.preview.url,
          resolved?.permaUrl ?? undefined,
          resolved?.byteLength ?? local?.byteLength,
        )
        return { ...file, localPreview: local?.preview }
      }),
    [parts, attachmentIds, urls],
  )

  return (
    <FileStrip
      data-slot="file-block"
      files={files}
      size={128}
      className="gap-(--message-block-gap) p-0"
      noAnimation
    />
  )
}
